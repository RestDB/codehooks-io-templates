// Product schema
export const productJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    price: { type: "number" }
  },
  required: ["name", "price"],
  additionalProperties: false
};
// Customer schema
export const customerJsonSchema = {
  type: "object",
  properties: {
    firstName: { type: "string" },
    lastName: { type: "string" },
    email: { type: "string", format: "email" },
    phoneNumber: { type: "string" },
    address: {
      type: "object",
      properties: {
        street: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        zipCode: { type: "string" }
      },
      required: ["street", "city", "state", "zipCode"]
    }
  },
  required: ["firstName", "lastName", "email"],
  additionalProperties: false
};


// Add other schemas here as needed

