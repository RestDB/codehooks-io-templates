export type FieldType =
  | 'text' | 'textarea' | 'email' | 'phone' | 'url'
  | 'number' | 'date' | 'rating' | 'select' | 'file';

export type FieldDef = {
  name: string;
  type: FieldType;
  required?: boolean;
  label?: string;
  min?: number;
  max?: number;
  options?: string[];
};

export type ValidationResult = {
  ok: boolean;
  errors: Array<{ field: string; message: string }>;
};

// Fields the submit endpoint interprets itself; never part of a form's schema.
const CONTROL_FIELDS = new Set(['_gotcha', '_redirect', '_subject', '_next']);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9\s().-]{5,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function checkOne(def: FieldDef, raw: string): string | null {
  const value = (raw ?? '').trim();

  if (!value) {
    return def.required ? `${def.label || def.name} is required` : null;
  }

  switch (def.type) {
    case 'email':
      return EMAIL_RE.test(value) ? null : 'Must be a valid email address';
    case 'phone':
      return PHONE_RE.test(value) ? null : 'Must be a valid phone number';
    case 'url':
      return /^https?:\/\/[^\s]+$/i.test(value) ? null : 'Must be a valid http(s) URL';
    case 'date':
      if (!DATE_RE.test(value)) return 'Must be an ISO date (YYYY-MM-DD)';
      return Number.isNaN(Date.parse(value)) ? 'Must be a valid date' : null;
    case 'number':
    case 'rating': {
      const n = Number(value);
      if (!Number.isFinite(n)) return 'Must be a number';
      if (def.min !== undefined && n < def.min) return `Must be at least ${def.min}`;
      if (def.max !== undefined && n > def.max) return `Must be at most ${def.max}`;
      return null;
    }
    case 'select':
      if (def.options && def.options.length && !def.options.includes(value)) {
        return `Must be one of: ${def.options.join(', ')}`;
      }
      return null;
    default: {
      if (def.max !== undefined && value.length > def.max) {
        return `Must be at most ${def.max} characters`;
      }
      return null;
    }
  }
}

export function validateFields(
  defs: FieldDef[],
  data: Record<string, string>,
  strict = false
): ValidationResult {
  const errors: Array<{ field: string; message: string }> = [];

  // No schema means accept anything — strict has nothing to measure against.
  if (!defs || defs.length === 0) return { ok: true, errors };

  for (const def of defs) {
    if (def.type === 'file') continue; // files are validated during persistence
    const message = checkOne(def, data[def.name]);
    if (message) errors.push({ field: def.name, message });
  }

  if (strict) {
    const known = new Set(defs.map((d) => d.name));
    for (const key of Object.keys(data)) {
      if (!known.has(key) && !CONTROL_FIELDS.has(key)) {
        errors.push({ field: key, message: 'Unknown field' });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
