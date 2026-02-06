import { z } from 'zod';

const testSchema = z.object({
  path: z.string().default("."),
  recursive: z.boolean().default(false),
});

console.log("Test 1: Empty object");
const result1 = testSchema.safeParse({});
console.log("Success:", result1.success);
console.log("Data:", result1.data);

console.log("\nTest 2: Object with only recursive");
const result2 = testSchema.safeParse({ recursive: true });
console.log("Success:", result2.success);
console.log("Data:", result2.data);

console.log("\nTest 3: Undefined");
const result3 = testSchema.safeParse(undefined);
console.log("Success:", result3.success);
if (!result3.success) console.log("Error:", result3.error.message);
