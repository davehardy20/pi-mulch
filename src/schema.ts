type JsonSchema = Record<string, unknown>;

const OPTIONAL = Symbol("optional");
type MaybeOptionalSchema = JsonSchema & { [OPTIONAL]?: true };

function stripOptional(schema: MaybeOptionalSchema): JsonSchema {
	const { [OPTIONAL]: _optional, ...rest } = schema;
	return rest;
}

export const Type = {
	Object(properties: Record<string, MaybeOptionalSchema>): JsonSchema {
		const required = Object.entries(properties)
			.filter(([, schema]) => schema[OPTIONAL] !== true)
			.map(([key]) => key);
		return {
			type: "object",
			properties: Object.fromEntries(
				Object.entries(properties).map(([key, schema]) => [
					key,
					stripOptional(schema),
				]),
			),
			...(required.length > 0 ? { required } : {}),
		};
	},
	Optional(schema: JsonSchema): MaybeOptionalSchema {
		return { ...schema, [OPTIONAL]: true };
	},
	Array(items: JsonSchema): JsonSchema {
		return { type: "array", items };
	},
	String(options: JsonSchema = {}): JsonSchema {
		return { type: "string", ...options };
	},
	Number(options: JsonSchema = {}): JsonSchema {
		return { type: "number", ...options };
	},
	Boolean(options: JsonSchema = {}): JsonSchema {
		return { type: "boolean", ...options };
	},
};
