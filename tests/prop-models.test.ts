import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';
import { ITEMS, ROOMS, TREASURES } from '../src/campaign.ts';
import { createGame } from '../src/game.ts';
import { houseExterior, isHouseGrounds } from '../src/scene-layout.ts';
import { makeProp } from '../src/models.ts';
import { placeCoffinContents } from '../src/coffin-pose.ts';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const sources = fs.readdirSync(sourceRoot).filter(name => name.endsWith('.ts')).map(name =>
  ts.createSourceFile(path.join(sourceRoot, name), fs.readFileSync(path.join(sourceRoot, name), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
const models = sources.find(source => path.basename(source.fileName) === 'models.ts')!;
const view = sources.find(source => path.basename(source.fileName) === 'view.ts')!;
const factory = models.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'makeProp') as ts.FunctionDeclaration;
assert.ok(factory?.body, 'The intentional prop factory must remain inspectable');
const dispatches = factory.body.statements.filter(ts.isSwitchStatement);
assert.equal(dispatches.length, 1, 'Audit the revised model dispatch explicitly instead of silently losing coverage');
const dispatch = dispatches[0];

function stopsFallthrough(statements: readonly ts.Statement[]): boolean {
  const last = statements.at(-1);
  if (!last) return false;
  if (ts.isBreakStatement(last) || ts.isReturnStatement(last) || ts.isThrowStatement(last)) return true;
  if (ts.isBlock(last)) return stopsFallthrough(last.statements);
  if (ts.isIfStatement(last) && last.elseStatement) return stopsFallthrough([last.thenStatement]) && stopsFallthrough([last.elseStatement]);
  return false;
}
const intentionalTypes = new Set<string>();
for (let index = 0; index < dispatch.caseBlock.clauses.length; index++) {
  const clause = dispatch.caseBlock.clauses[index];
  if (!ts.isCaseClause(clause)) continue;
  assert.ok(ts.isStringLiteralLike(clause.expression), 'A computed model case needs explicit audit support');
  // An empty alias followed by default is still a fallback, not an authored
  // model. Follow actual switch fallthrough rather than merely counting labels.
  for (let next = index; next < dispatch.caseBlock.clauses.length; next++) {
    const destination = dispatch.caseBlock.clauses[next];
    if (ts.isDefaultClause(destination)) break;
    if (stopsFallthrough(destination.statements)) { intentionalTypes.add(clause.expression.text); break; }
  }
}

type PropCall = { source: ts.SourceFile; node: ts.CallExpression; owner: ts.Node; key: string };
const propCalls: PropCall[] = [];
function enclosingOwner(node: ts.Node): ts.Node {
  let owner = node.parent;
  while (owner && !ts.isConstructorDeclaration(owner) && !ts.isMethodDeclaration(owner) && !ts.isFunctionDeclaration(owner)) owner = owner.parent;
  return owner;
}
for (const source of sources) {
  const direct = new Set<string>(), namespaces = new Set<string>();
  if (source === models) direct.add('makeProp');
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const imported = path.resolve(path.dirname(source.fileName), statement.moduleSpecifier.text);
    if (imported !== path.resolve(models.fileName) && `${imported}.ts` !== path.resolve(models.fileName)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
      if ((binding.propertyName ?? binding.name).text === 'makeProp') direct.add(binding.name.text);
    }
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
  }
  const factoryReference = (node: ts.Node) => ts.isIdentifier(node) && direct.has(node.text)
    || ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && namespaces.has(node.expression.text) && node.name.text === 'makeProp';
  function visit(node: ts.Node): void {
    if (factoryReference(node)) {
      const declaration = ts.isImportSpecifier(node.parent) || ts.isFunctionDeclaration(node.parent) && node.parent.name === node;
      const namespaceMember = ts.isIdentifier(node) && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
      if (!declaration && !namespaceMember) {
        assert.ok(ts.isCallExpression(node.parent) && node.parent.expression === node,
          `Indirect prop factory use must be added to the audit: ${path.basename(source.fileName)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
      }
    }
    if (ts.isCallExpression(node) && factoryReference(node.expression)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      propCalls.push({ source, node, owner: enclosingOwner(node), key: `${path.basename(source.fileName)}:${line}` });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

// Run the actual refresh method on CPU scene objects. Only WebGL/architecture,
// prop geometry and animation are replaced; selection expressions and their
// branching/caching/treasure loops are the unmodified production method body.
const refresh = propCalls.find(call => ts.isMethodDeclaration(call.owner) && call.owner.name.getText(view) === 'refreshObjects')?.owner as ts.MethodDeclaration;
assert.ok(refresh?.body, 'The runtime prop selection method must be included');
for (const call of propCalls) {
  const heldLiteral = ts.isConstructorDeclaration(call.owner) && ts.isStringLiteralLike(call.node.arguments[0]);
  assert.ok(call.owner === refresh || heldLiteral,
    `A new runtime prop factory call needs coverage: ${call.key}. Do not bypass this check with a list of guessed types.`);
}
const callKeys = new Map(propCalls.map(call => [call.node.getStart(call.source), call.key]));
const functionNode = ts.factory.createFunctionExpression(undefined, undefined, undefined, undefined, refresh.parameters, undefined, refresh.body!);
const transformed = ts.transform(functionNode, [context => node => {
  function visit(child: ts.Node): ts.VisitResult<ts.Node> {
    if (ts.isCallExpression(child) && callKeys.has(child.getStart(view))) {
      return ts.factory.createCallExpression(ts.factory.createIdentifier('captureProp'), undefined,
        [ts.factory.createStringLiteral(callKeys.get(child.getStart(view))!), ...child.arguments]);
    }
    return ts.visitEachChild(child, visit, context);
  }
  return ts.visitNode(node, visit) as ts.FunctionExpression;
}]);
const printed = ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Expression, transformed.transformed[0], view);
const refreshJavaScript = ts.transpileModule(`(${printed})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
transformed.dispose();

const selectorFlags = new Set<string>();
function flagReads(node: ts.Node): void {
  if (ts.isPropertyAccessExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'flags' && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'state') selectorFlags.add(node.name.text);
  if (ts.isElementAccessExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'flags' && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'state') {
    const key = node.argumentExpression;
    if (ts.isStringLiteralLike(key)) selectorFlags.add(key.text);
    else assert.ok(ts.isPropertyAccessExpression(key) && ['hiddenIf', 'requires'].includes(key.name.text),
      'A new computed model-selection flag needs an explicit finite state domain');
  }
  ts.forEachChild(node, flagReads);
}
flagReads(refresh);

// Also inspect literal result branches of the real selector expressions. A
// future rare condition must not hide an unregistered string just because none
// of today's scene witnesses happens to enter that branch.
function selectorLiterals(expression: ts.Expression, seen = new Set<string>()): string[] {
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression)) return selectorLiterals(expression.expression, seen);
  if (ts.isConditionalExpression(expression)) return [...selectorLiterals(expression.whenTrue, seen), ...selectorLiterals(expression.whenFalse, seen)];
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    return [...selectorLiterals(expression.left, seen), ...selectorLiterals(expression.right, seen)];
  if (ts.isObjectLiteralExpression(expression)) return expression.properties.flatMap(property => {
    assert.ok(ts.isPropertyAssignment(property), 'An indirect trophy model map needs explicit audit support');
    return selectorLiterals(property.initializer, seen);
  });
  if (ts.isElementAccessExpression(expression)) return selectorLiterals(expression.expression, seen);
  if (ts.isPropertyAccessExpression(expression) && expression.name.text === 'type') return []; // actual room data is checked below
  if (ts.isIdentifier(expression)) {
    if (expression.text === 'TREASURES') return []; // the actual complete array drives the production trophy loop
    assert.ok(!seen.has(expression.text), `Circular prop selector: ${expression.text}`);
    const declarations: ts.VariableDeclaration[] = [];
    const find = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === expression.text) declarations.push(node); ts.forEachChild(node, find); };
    find(refresh);
    assert.equal(declarations.length, 1, `A new or ambiguous selector source needs audit support: ${expression.text}`);
    assert.ok(declarations[0].initializer, `Uninitialized prop selector: ${expression.text}`);
    return selectorLiterals(declarations[0].initializer!, new Set([...seen, expression.text]));
  }
  assert.fail(`A new model selector expression needs audit support: ${expression.getText(view)}`);
}
const literalRuntimeTypes = new Set(propCalls.flatMap(call => selectorLiterals(call.node.arguments[0])));

function collectRuntimeSelections() {
  const selected = new Map<string, Set<string>>(), callCounts = new Map<string, number>();
  const add = (type: string, context: string) => {
    assert.equal(typeof type, 'string', `${context}: prop factory received a non-string type`);
    if (!selected.has(type)) selected.set(type, new Set());
    selected.get(type)!.add(context);
  };
  for (const call of propCalls.filter(call => ts.isConstructorDeclaration(call.owner))) {
    add((call.node.arguments[0] as ts.StringLiteral).text, `held equipment ${call.key}`);
    callCounts.set(call.key, 1);
  }
  let context = '', cases = 0;
  const geometry = new THREE.BoxGeometry(.1, .1, .1), material = new THREE.MeshBasicMaterial();
  const captureProp = (key: string, type: string) => {
    add(type, `${context} ${key}`); callCounts.set(key, (callCounts.get(key) ?? 0) + 1);
    const group = new THREE.Group(); group.add(new THREE.Mesh(geometry, material));
    // Slot placement belongs to art/spatial review. Available slots let the real
    // loop request every currently depositable treasure, including alias types.
    if (type === 'case' || type === 'trophy_case') group.userData.displaySlots = TREASURES.map(() => [0, 0, 0]);
    return group;
  };
  const architectureNotNeeded = () => { throw new Error('This prop-selection test must not construct a renderer or architecture'); };
  const run = new Function('THREE', 'captureProp', 'isHouseGrounds', 'houseExterior', 'buildWorld', 'buildHouseExterior', 'TREASURES', 'placeCoffinContents', `return ${refreshJavaScript}`)
    (THREE, captureProp, isHouseGrounds, houseExterior, architectureNotNeeded, architectureNotNeeded, TREASURES, placeCoffinContents);
  const makeView = (room: typeof ROOMS[string], worldRoom: typeof ROOMS[string]) => ({
    room, worldRoom, objects: new Map(), environment: new THREE.Group(), materials: {},
    architecture: undefined, architectureState: '', structuralState: () => '',
    transparentMaterials: new Set(), treasureGlows: [], objectRotations: new Map(),
    setObjectPose: () => {}, caseState: '',
  });
  try {
    for (const room of Object.values(ROOMS)) {
      const seed = createGame(); seed.room = room.id;
      const worldRoom = isHouseGrounds(room.id) ? houseExterior(seed) : room;
      const keys = [...new Set([...selectorFlags, ...worldRoom.objects.flatMap(object => [object.requires, object.hiddenIf].filter((value): value is string => !!value))])];
      assert.ok(keys.length <= 12, `${room.id}: local state space grew; add a complete bounded selection strategy`);
      // Enumerate independent local visibility/state bits. This intentionally
      // includes intermediate combinations; no first-room or all-flags-only shortcut.
      for (let mask = 0; mask < 2 ** keys.length; mask++) {
        const state = createGame(); state.room = room.id;
        state.flags = Object.fromEntries(keys.map((key, bit) => [key, !!(mask & (1 << bit))]));
        state.inventory = Object.keys(ITEMS).filter(id => !TREASURES.includes(id));
        state.deposited = [...TREASURES];
        context = `${room.id} flags=${mask}`;
        run.call(makeView(room, worldRoom), state); cases++;
      }
      // Reuse an existing scene through every selector-state combination too:
      // cached objects must not hide the folded/inflated boat replacement branch.
      const cached = makeView(room, worldRoom);
      for (let mask = 0; mask < 2 ** selectorFlags.size; mask++) {
        const state = createGame(); state.room = room.id;
        state.flags = Object.fromEntries([...selectorFlags].map((key, bit) => [key, !!(mask & (1 << bit))]));
        for (const object of worldRoom.objects) { if (object.requires) state.flags[object.requires] = true; if (object.hiddenIf) state.flags[object.hiddenIf] = false; }
        state.deposited = [...TREASURES]; context = `${room.id} cached flags=${mask}`;
        run.call(cached, state); cases++;
      }
    }
  } finally { geometry.dispose(); material.dispose(); }
  for (const call of propCalls) assert.ok(callCounts.get(call.key), `The production factory call ${call.key} was never exercised`);
  return { selected, cases, callCounts };
}

function withCanvas<T>(action: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const context = new Proxy({}, { get: () => () => {} });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ width: 512, height: 512, getContext: () => context }),
  } });
  try { return action(); }
  finally { if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document'); }
}

test('every campaign prop, including unrevealed rewards, has an intentional factory branch', () => {
  const missing = Object.values(ROOMS).flatMap(room => room.objects.filter(object => !intentionalTypes.has(object.type.toLowerCase()))
    .map(object => `${room.id}/${object.id}: ${object.type}`));
  assert.deepEqual(missing, [], 'Campaign props must never fall through to a generic ornament; author the missing model or deliberately use an architectural surface');
});

test('actual runtime selectors, held equipment and every trophy miniature resolve without a fallback', t => {
  const coverage = collectRuntimeSelections();
  const allTypes = new Set([...coverage.selected.keys(), ...literalRuntimeTypes, ...Object.values(ROOMS).flatMap(room => room.objects.map(object => object.type))]);
  const rock = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  const diagnostics: string[] = [], originalError = console.error;
  console.error = (...parts: unknown[]) => { diagnostics.push(parts.map(String).join(' ')); };
  try {
    withCanvas(() => {
      for (const type of allTypes) {
        assert.ok(intentionalTypes.has(type.toLowerCase()), `Runtime selection has no intentional model: ${type}`);
        const group = makeProp(type, { rock });
        assert.ok(['authored', 'external'].includes(group.userData.modelResolution),
          `${type}: the real prop factory must identify an authored model or intentional external architecture`);
        group.traverse(node => { if (node instanceof THREE.Mesh) node.geometry.dispose(); });
      }
    });
    assert.deepEqual(diagnostics, [], 'Known runtime props must not report missing models');
  } finally { console.error = originalError; rock.map?.dispose(); rock.dispose(); }
  t.diagnostic(`${coverage.cases} local/cached scene states; ${coverage.callCounts.size} production factory call sites; ${coverage.selected.size} runtime types; all ${TREASURES.length} trophy entries included.`);
});

test('an unknown prop is diagnosed and cannot masquerade as a collectible ornament', () => {
  const unknown = '__unregistered_prop_regression__', diagnostics: string[] = [];
  assert.equal(intentionalTypes.has(unknown), false);
  const originalError = console.error;
  console.error = (...parts: unknown[]) => { diagnostics.push(parts.map(String).join(' ')); };
  try {
    const group = withCanvas(() => makeProp(unknown));
    assert.equal(group.userData.modelResolution, 'missing');
    assert.ok(diagnostics.some(message => message.includes(unknown)), 'Missing model diagnostics must identify the requested type');
    let visibleMeshes = 0; group.traverse(node => { if (node instanceof THREE.Mesh) visibleMeshes++; });
    assert.equal(visibleMeshes, 0, 'A missing model must not display the old gold/gem fallback or another deceptive ornament');
  } finally { console.error = originalError; }
});
