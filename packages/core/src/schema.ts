export type SemanticRole = "person.email" | "company.name" | "company.domain";
export type FieldPrivacy = "plain" | "mask" | "omit";

interface FieldOptions {
  required?: boolean;
  label?: string;
  role?: SemanticRole;
  privacy?: FieldPrivacy;
}

export type FieldDefinition =
  | (FieldOptions & { type: "string" })
  | (FieldOptions & { type: "email" })
  | (FieldOptions & { type: "integer"; minimum?: number; maximum?: number })
  | (FieldOptions & { type: "boolean" })
  | (FieldOptions & { type: "enum"; values: readonly string[] });

export type FormSchema = Record<string, FieldDefinition>;

type FieldValue<Field extends FieldDefinition> = Field extends { type: "integer" }
  ? number
  : Field extends { type: "boolean" }
    ? boolean
    : Field extends { type: "enum"; values: readonly (infer Value extends string)[] }
      ? Value
      : string;

type RequiredKeys<Schema extends FormSchema> = {
  [Key in keyof Schema]: Schema[Key] extends { required: true } ? Key : never;
}[keyof Schema];

type OptionalKeys<Schema extends FormSchema> = Exclude<keyof Schema, RequiredKeys<Schema>>;

export type InferInput<Schema extends FormSchema> = {
  [Key in RequiredKeys<Schema>]: FieldValue<Schema[Key]>;
} & {
  [Key in OptionalKeys<Schema>]?: FieldValue<Schema[Key]>;
};

export interface ParseOptions {
  /** Convert HTML form strings into integer and boolean field values. */
  coerce?: boolean;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export class SubmissionValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super("Submission does not match the configured form schema");
    this.name = "SubmissionValidationError";
    this.issues = issues;
  }
}

export function defineSchema<const Schema extends FormSchema>(schema: Schema): Schema {
  return schema;
}

function parseField(
  field: string,
  definition: FieldDefinition,
  rawValue: unknown,
  options: ParseOptions,
): { value?: unknown; issue?: ValidationIssue } {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return definition.required ? { issue: { field, message: "is required" } } : {};
  }

  let value = rawValue;
  if (options.coerce && typeof value === "string") {
    if (definition.type === "integer" && /^-?\d+$/.test(value)) {
      value = Number(value);
    }
    if (definition.type === "boolean" && (value === "true" || value === "false")) {
      value = value === "true";
    }
  }

  if (definition.type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return { issue: { field, message: "must be an integer" } };
    }
    if (definition.minimum !== undefined && value < definition.minimum) {
      return { issue: { field, message: `must be at least ${definition.minimum}` } };
    }
    if (definition.maximum !== undefined && value > definition.maximum) {
      return { issue: { field, message: `must be at most ${definition.maximum}` } };
    }
    return { value };
  }

  if (definition.type === "boolean") {
    return typeof value === "boolean"
      ? { value }
      : { issue: { field, message: "must be a boolean" } };
  }

  if (typeof value !== "string") {
    return { issue: { field, message: "must be a string" } };
  }

  if (definition.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { issue: { field, message: "must be a valid email address" } };
  }

  if (definition.type === "enum" && !definition.values.includes(value)) {
    return { issue: { field, message: `must be one of: ${definition.values.join(", ")}` } };
  }

  return { value };
}

export function parseSubmission<Schema extends FormSchema>(
  schema: Schema,
  rawInput: unknown,
  options: ParseOptions = {},
): InferInput<Schema> {
  if (typeof rawInput !== "object" || rawInput === null || Array.isArray(rawInput)) {
    throw new SubmissionValidationError([{ field: "$", message: "must be an object" }]);
  }

  const source = rawInput as Record<string, unknown>;
  const parsed: Record<string, unknown> = {};
  const issues: ValidationIssue[] = [];

  for (const [field, definition] of Object.entries(schema)) {
    const result = parseField(field, definition, source[field], options);
    if (result.issue) issues.push(result.issue);
    if (result.value !== undefined) parsed[field] = result.value;
  }

  for (const field of Object.keys(source)) {
    if (!(field in schema)) issues.push({ field, message: "is not declared in the form schema" });
  }

  if (issues.length > 0) throw new SubmissionValidationError(issues);
  return parsed as InferInput<Schema>;
}
