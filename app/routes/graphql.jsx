import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const { query, variables } = await request.json();

  try {
    const response = await admin.graphql(query, variables);
    const data = await response.json();
    if (data.errors) {
      throw new Error(data.errors.map(error => error.message).join(", "));
    }
    return json({ data: data.data });
  } catch (error) {
    console.error("GraphQL error:", error);
    return json({ errors: [{ message: error.message }] }, { status: 500 });
  }
};
