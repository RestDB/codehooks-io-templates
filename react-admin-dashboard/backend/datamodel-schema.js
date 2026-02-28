/**
 * JSON Schema that validates the datamodel configuration format.
 * Used to validate PUT /api/datamodel requests.
 */
export const datamodelSchema = {
  type: 'object',
  required: ['collections'],
  additionalProperties: false,
  properties: {
    app: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        subtitle: { type: 'string' },
        icon: { type: 'string' },
      },
      additionalProperties: false,
    },
    collections: {
      type: 'object',
      minProperties: 1,
      additionalProperties: {
        type: 'object',
        required: ['label', 'icon', 'schema', 'listFields', 'searchFields'],
        additionalProperties: false,
        properties: {
          label: { type: 'string', minLength: 1 },
          icon: { type: 'string' },
          schema: {
            type: 'object',
            required: ['type', 'properties'],
            properties: {
              type: { type: 'string', const: 'object' },
              properties: {
                type: 'object',
                minProperties: 1,
                additionalProperties: {
                  type: 'object',
                  required: ['type'],
                  properties: {
                    type: { type: 'string', enum: ['string', 'number', 'integer', 'boolean', 'object', 'array'] },
                    title: { type: 'string' },
                    format: { type: 'string' },
                    enum: { type: 'array', items: { type: 'string' } },
                    default: {},
                    minLength: { type: 'integer', minimum: 0 },
                    maxLength: { type: 'integer', minimum: 0 },
                    minimum: { type: 'number' },
                    maximum: { type: 'number' },
                    properties: { type: 'object' },
                    items: { type: 'object' },
                    'x-accept': { type: 'string' },
                    'x-lookup': {
                      type: 'object',
                      required: ['collection', 'displayField', 'searchFields'],
                      additionalProperties: false,
                      properties: {
                        collection: { type: 'string', minLength: 1 },
                        displayField: {
                          oneOf: [
                            { type: 'string', minLength: 1 },
                            { type: 'array', items: { type: 'string' }, minItems: 1 },
                          ],
                        },
                        searchFields: { type: 'array', items: { type: 'string' }, minItems: 1 },
                      },
                    },
                  },
                  additionalProperties: true,
                },
              },
              required: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: true,
          },
          listFields: { type: 'array', items: { type: 'string' }, minItems: 1 },
          searchFields: { type: 'array', items: { type: 'string' } },
          defaultSort: { type: 'object' },
          treeView: {
            type: 'object',
            properties: {
              parentField: { type: 'string', minLength: 1 },
            },
            required: ['parentField'],
            additionalProperties: false,
          },
          relatedCollections: {
            type: 'array',
            items: {
              type: 'object',
              required: ['collection', 'foreignKey', 'title', 'displayFields'],
              additionalProperties: false,
              properties: {
                collection: { type: 'string', minLength: 1 },
                foreignKey: { type: 'string', minLength: 1 },
                title: { type: 'string', minLength: 1 },
                displayFields: { type: 'array', items: { type: 'string' }, minItems: 1 },
                sort: { type: 'object' },
                allowCreate: { type: 'boolean' },
                filters: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['field', 'value', 'label'],
                    additionalProperties: false,
                    properties: {
                      field: { type: 'string', minLength: 1 },
                      value: {},
                      label: { type: 'string', minLength: 1 },
                      exclude: { type: 'boolean' },
                      active: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
