/**
 * Safe expression evaluator for x-calculate fields.
 * Supports: field references, numbers, +, -, *, /, %, parentheses, unary minus.
 * No eval() — uses a tokenizer + recursive descent parser.
 */

// --- Tokenizer ---

const TOKEN = {
  NUMBER: 'NUMBER',
  IDENT: 'IDENT',
  OP: 'OP',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
};

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let num = '';
      while (i < expr.length && /[0-9.]/.test(expr[i])) { num += expr[i++]; }
      tokens.push({ type: TOKEN.NUMBER, value: parseFloat(num) });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let id = '';
      while (i < expr.length && /[a-zA-Z0-9_.]/.test(expr[i])) { id += expr[i++]; }
      tokens.push({ type: TOKEN.IDENT, value: id });
      continue;
    }
    if ('+-*/%'.includes(ch)) {
      tokens.push({ type: TOKEN.OP, value: ch });
      i++;
      continue;
    }
    if (ch === '(') { tokens.push({ type: TOKEN.LPAREN }); i++; continue; }
    if (ch === ')') { tokens.push({ type: TOKEN.RPAREN }); i++; continue; }
    throw new Error(`Unexpected character: ${ch}`);
  }
  return tokens;
}

// --- Parser (recursive descent) ---

function parse(tokens) {
  let pos = 0;

  function peek() { return tokens[pos] || null; }
  function consume() { return tokens[pos++]; }

  // expression = term (('+' | '-') term)*
  function parseExpression() {
    let left = parseTerm();
    while (peek() && peek().type === TOKEN.OP && (peek().value === '+' || peek().value === '-')) {
      const op = consume().value;
      const right = parseTerm();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  // term = unary (('*' | '/' | '%') unary)*
  function parseTerm() {
    let left = parseUnary();
    while (peek() && peek().type === TOKEN.OP && ('*/%'.includes(peek().value))) {
      const op = consume().value;
      const right = parseUnary();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  // unary = '-' unary | primary
  function parseUnary() {
    if (peek() && peek().type === TOKEN.OP && peek().value === '-') {
      consume();
      const operand = parseUnary();
      return { type: 'unary', op: '-', operand };
    }
    return parsePrimary();
  }

  // primary = NUMBER | IDENT | '(' expression ')'
  function parsePrimary() {
    const tok = peek();
    if (!tok) throw new Error('Unexpected end of expression');

    if (tok.type === TOKEN.NUMBER) {
      consume();
      return { type: 'number', value: tok.value };
    }
    if (tok.type === TOKEN.IDENT) {
      consume();
      return { type: 'field', name: tok.value };
    }
    if (tok.type === TOKEN.LPAREN) {
      consume();
      const expr = parseExpression();
      const closing = consume();
      if (!closing || closing.type !== TOKEN.RPAREN) {
        throw new Error('Missing closing parenthesis');
      }
      return expr;
    }
    throw new Error(`Unexpected token: ${JSON.stringify(tok)}`);
  }

  const ast = parseExpression();
  if (pos < tokens.length) {
    throw new Error(`Unexpected token after expression: ${JSON.stringify(tokens[pos])}`);
  }
  return ast;
}

// --- Evaluator ---

function resolveField(record, fieldPath) {
  const parts = fieldPath.split('.');
  let value = record;
  for (const part of parts) {
    if (value == null || typeof value !== 'object') return undefined;
    value = value[part];
  }
  return value;
}

function evalAST(ast, record) {
  switch (ast.type) {
    case 'number':
      return ast.value;
    case 'field': {
      const val = resolveField(record, ast.name);
      if (val == null || typeof val !== 'number') return null;
      return val;
    }
    case 'unary': {
      const operand = evalAST(ast.operand, record);
      if (operand == null) return null;
      return -operand;
    }
    case 'binary': {
      const left = evalAST(ast.left, record);
      const right = evalAST(ast.right, record);
      if (left == null || right == null) return null;
      switch (ast.op) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/': return right === 0 ? null : left / right;
        case '%': return right === 0 ? null : left % right;
        default: return null;
      }
    }
    default:
      return null;
  }
}

// --- Cache parsed expressions ---
const parseCache = new Map();

/**
 * Validate a formula expression string.
 * Returns null if valid, or an error message string.
 */
export function validateFormula(expression) {
  if (!expression || !expression.trim()) return null;
  try {
    const tokens = tokenize(expression);
    parse(tokens);
    return null;
  } catch (err) {
    return err.message;
  }
}

/**
 * Validate all x-calculate formulas in a datamodel.
 * Returns an array of { collection, field, error } for invalid formulas.
 */
export function validateAllFormulas(datamodel) {
  const errors = [];
  for (const [collName, collConfig] of Object.entries(datamodel.collections || {})) {
    for (const [fieldName, propDef] of Object.entries(collConfig.schema?.properties || {})) {
      if (propDef['x-calculate']) {
        const err = validateFormula(propDef['x-calculate']);
        if (err) {
          errors.push({ collection: collName, field: fieldName, error: err });
        }
      }
    }
  }
  return errors;
}

/**
 * Evaluate an expression string against a record.
 * Returns the computed number or null if any field is missing.
 */
export function evaluate(expression, record) {
  try {
    let ast = parseCache.get(expression);
    if (!ast) {
      const tokens = tokenize(expression);
      ast = parse(tokens);
      parseCache.set(expression, ast);
    }
    return evalAST(ast, record);
  } catch (err) {
    console.error(`Calculate expression error "${expression}": ${err.message}`);
    return null;
  }
}

/**
 * Extract calculated field definitions from a collection config.
 * Returns [{ field, expression }]
 */
export function getCalculatedFields(collectionConfig) {
  if (!collectionConfig?.schema?.properties) return [];
  const result = [];
  for (const [field, propDef] of Object.entries(collectionConfig.schema.properties)) {
    if (propDef['x-calculate']) {
      result.push({ field, expression: propDef['x-calculate'] });
    }
  }
  return result;
}

/**
 * Extract base field names referenced in an expression.
 * E.g., "product.price * quantity" → ['product', 'quantity']
 */
function extractFieldRefs(expression) {
  try {
    const tokens = tokenize(expression);
    return tokens
      .filter((t) => t.type === TOKEN.IDENT)
      .map((t) => t.value.split('.')[0]);
  } catch {
    return [];
  }
}

/**
 * Topologically sort calculated fields so dependencies are evaluated first.
 * E.g., if `total = subtotal + tax` and `subtotal = price * quantity`,
 * subtotal will be evaluated before total.
 * Logs a warning and breaks the cycle if circular dependencies are detected.
 */
function topoSort(calculatedFields) {
  if (calculatedFields.length <= 1) return calculatedFields;

  const calcNames = new Set(calculatedFields.map((f) => f.field));
  const deps = new Map();
  for (const { field, expression } of calculatedFields) {
    const refs = extractFieldRefs(expression).filter((r) => calcNames.has(r) && r !== field);
    deps.set(field, new Set(refs));
  }

  const sorted = [];
  const visited = new Set();
  const visiting = new Set();

  function visit(field) {
    if (visited.has(field)) return;
    if (visiting.has(field)) {
      console.error(`Circular dependency detected in calculated field: ${field}`);
      return;
    }
    visiting.add(field);
    for (const dep of deps.get(field) || []) {
      visit(dep);
    }
    visiting.delete(field);
    visited.add(field);
    sorted.push(field);
  }

  for (const { field } of calculatedFields) {
    visit(field);
  }

  const fieldMap = new Map(calculatedFields.map((f) => [f.field, f]));
  return sorted.map((name) => fieldMap.get(name));
}

/**
 * Apply all calculated fields to a record (mutates the record).
 * Fields are topologically sorted so that dependencies between
 * calculated fields are resolved in the correct order.
 * Returns the record for chaining.
 */
export function applyCalculations(record, calculatedFields) {
  const ordered = topoSort(calculatedFields);
  for (const { field, expression } of ordered) {
    const value = evaluate(expression, record);
    if (value != null) {
      // Round to 10 significant decimals to avoid floating-point artifacts
      record[field] = Math.round(value * 1e10) / 1e10;
    }
  }
  return record;
}

/**
 * Enrich lookup fields by fetching full referenced documents from the DB.
 * This allows calculated expressions like "product.price" to resolve even though
 * the stored lookup only contains { _id, ...displayFields }.
 * Returns a shallow copy with enriched lookup fields (does not mutate the original).
 */
export async function enrichLookups(record, collectionConfig, conn) {
  const props = collectionConfig?.schema?.properties || {};
  const enriched = { ...record };
  for (const [field, propDef] of Object.entries(props)) {
    if (propDef['x-lookup'] && enriched[field]?._id) {
      try {
        const fullDoc = await conn.findOne(propDef['x-lookup'].collection, enriched[field]._id);
        enriched[field] = fullDoc;
      } catch {
        // Referenced doc not found, leave as-is
      }
    }
  }
  return enriched;
}

/**
 * Compare old and new calculated fields to detect changes.
 * Returns true if any formula was added, removed, or modified.
 */
export function hasCalcChanges(oldFields, newFields) {
  if (oldFields.length !== newFields.length) return true;
  const oldMap = new Map(oldFields.map(f => [f.field, f.expression]));
  for (const { field, expression } of newFields) {
    if (oldMap.get(field) !== expression) return true;
  }
  return false;
}
