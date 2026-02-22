import { marked } from 'marked';
import LookupField from './LookupField.jsx';
import MultiLookupField from './MultiLookupField.jsx';
import FileField from './FileField.jsx';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

marked.setOptions({ breaks: true, gfm: true });

export default function FormField({
  name,
  schema,
  value,
  onChange,
  readOnly,
  required,
  error,
}) {
  if (schema['x-lookup'] && schema.type === 'array') {
    return (
      <MultiLookupField
        name={name}
        schema={schema}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        required={required}
        error={error}
      />
    );
  }

  if (schema['x-lookup']) {
    return (
      <LookupField
        name={name}
        schema={schema}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        required={required}
        error={error}
      />
    );
  }

  // File or Image upload
  if (schema.format === 'file' || schema.format === 'image') {
    return (
      <FileField
        name={name}
        schema={schema}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        required={required}
        error={error}
      />
    );
  }

  const label = schema.title || name;
  const type = schema.type;
  const format = schema.format;

  // Read-only display
  if (readOnly) {
    return (
      <div className={`space-y-2 ${format === 'textarea' ? 'md:col-span-2' : ''}`}>
        <Label className="font-medium">{label}</Label>
        <div className="px-3 py-2 bg-muted rounded-md min-h-[2.5rem]">
          <DisplayValue value={value} schema={schema} />
        </div>
      </div>
    );
  }

  // Enum / select
  if (schema.enum) {
    return (
      <div className="space-y-2">
        <Label className="font-medium">
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
        <Select value={value || ''} onValueChange={(val) => onChange(val)}>
          <SelectTrigger className={error ? 'border-destructive' : ''}>
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            {schema.enum.map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError error={error} />
      </div>
    );
  }

  // Boolean / checkbox
  if (type === 'boolean') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3 pt-6">
          <Checkbox
            id={name}
            checked={value || false}
            onCheckedChange={(checked) => onChange(checked)}
          />
          <Label htmlFor={name} className="font-medium cursor-pointer">{label}</Label>
        </div>
        <FieldError error={error} />
      </div>
    );
  }

  // Textarea
  if (format === 'textarea') {
    return (
      <div className="space-y-2 md:col-span-2">
        <Label className="font-medium">
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
        <Textarea
          className={error ? 'border-destructive' : ''}
          rows={3}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Enter ${label.toLowerCase()}`}
        />
        <FieldError error={error} />
      </div>
    );
  }

  // Number
  if (type === 'number' || type === 'integer') {
    return (
      <div className="space-y-2">
        <Label className="font-medium">
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
        <Input
          type="number"
          className={error ? 'border-destructive' : ''}
          value={value ?? ''}
          onChange={(e) =>
            onChange(e.target.value === '' ? undefined : Number(e.target.value))
          }
          min={schema.minimum}
          max={schema.maximum}
          step={type === 'integer' ? 1 : 'any'}
          placeholder={`Enter ${label.toLowerCase()}`}
        />
        <FieldError error={error} />
      </div>
    );
  }

  // Date
  if (format === 'date') {
    return (
      <div className="space-y-2">
        <Label className="font-medium">
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
        <Input
          type="date"
          className={error ? 'border-destructive' : ''}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
        />
        <FieldError error={error} />
      </div>
    );
  }

  // Date-time
  if (format === 'date-time') {
    const localValue = value ? value.slice(0, 16) : '';
    return (
      <div className="space-y-2">
        <Label className="font-medium">
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
        <Input
          type="datetime-local"
          className={error ? 'border-destructive' : ''}
          value={localValue}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : '')}
        />
        <FieldError error={error} />
      </div>
    );
  }

  // Default: text input
  const inputType =
    format === 'email' ? 'email' : format === 'url' ? 'url' : 'text';

  return (
    <div className="space-y-2">
      <Label className="font-medium">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <Input
        type={inputType}
        className={error ? 'border-destructive' : ''}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Enter ${label.toLowerCase()}`}
      />
      <FieldError error={error} />
    </div>
  );
}

function FieldError({ error }) {
  if (!error) return null;
  return <p className="text-sm text-destructive">{error}</p>;
}

function DisplayValue({ value, schema }) {
  if (value === undefined || value === null || value === '') {
    return <span className="text-muted-foreground/50">--</span>;
  }
  if (schema.type === 'boolean') {
    return (
      <Badge variant={value ? 'default' : 'secondary'} className="text-xs">
        {value ? 'Yes' : 'No'}
      </Badge>
    );
  }
  if (schema.enum) {
    return <Badge variant="outline" className="text-xs">{String(value)}</Badge>;
  }
  if ((schema.format === 'date-time' || schema.format === 'date') && typeof value === 'string') {
    try {
      const d = new Date(value);
      return <span>{schema.format === 'date-time' ? d.toLocaleString() : d.toLocaleDateString()}</span>;
    } catch { /* fall through */ }
  }
  if (schema.format === 'textarea' && typeof value === 'string') {
    return (
      <div
        className="prose prose-sm max-w-none dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: marked.parse(value) }}
      />
    );
  }
  return <span>{String(value)}</span>;
}
