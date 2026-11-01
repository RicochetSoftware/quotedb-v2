import type { FieldError, FieldErrors, FieldValues, Resolver } from 'react-hook-form'
import type Type from 'typebox'
import { Compile } from 'typebox/compile'

/** Friendlier messages for the TypeBox/Ajv keywords our forms actually hit. */
function messageFor(error: { keyword: string; message: string; params: Record<string, unknown> }) {
  switch (error.keyword) {
    case 'minLength':
      return error.params.limit === 1
        ? 'Required'
        : `Must be at least ${error.params.limit} characters`
    case 'maxLength':
      return `Must be at most ${error.params.limit} characters`
    case 'format':
      return error.params.format === 'email'
        ? 'Enter a valid email address'
        : `Must be a valid ${error.params.format}`
    case 'required':
      return 'Required'
    case 'minItems':
      return 'Pick at least one'
    default:
      return error.message
  }
}

/**
 * react-hook-form resolver for TypeBox 1.x, so forms validate with the same schemas as the API.
 * (`@hookform/resolvers/typebox` targets the older `@sinclair/typebox` package.)
 */
export function typeboxResolver<
  T extends Type.TSchema,
  V extends FieldValues = Type.Static<T> & FieldValues,
>(schema: T): Resolver<V> {
  const check = Compile(schema)
  return async (values) => {
    // Empty optional inputs come through as '' — drop them so optional fields stay optional.
    const cleaned = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v !== '' && v !== undefined),
    )
    if (check.Check(cleaned)) return { values: cleaned as V, errors: {} }

    const errors: Record<string, FieldError> = {}
    for (const error of check.Errors(cleaned)) {
      const path =
        error.keyword === 'required'
          ? String((error.params.requiredProperties as string[] | undefined)?.[0] ?? '')
          : error.instancePath.replace(/^\//, '').split('/')[0]
      if (path && !errors[path]) {
        errors[path] = { type: error.keyword, message: messageFor(error as never) }
      }
    }
    return { values: {}, errors: errors as FieldErrors<V> }
  }
}
