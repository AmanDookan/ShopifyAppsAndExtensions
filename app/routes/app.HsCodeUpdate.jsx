import React, { useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Button,
  Text,
  Banner,
  Spinner,
  DataTable,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import Papa from "papaparse";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useActionData } from "@remix-run/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  try {
    const { admin } = await authenticate.admin(request);

    const appIdResponse = await admin.graphql(`
      query {
        currentAppInstallation {
          id
        }
      }
    `);
    const appId = await appIdResponse.json();
    const appInstallationId = appId.data.currentAppInstallation.id;

    return json({ appInstallationId });
  } catch (error) {
    console.error("Error in loader function:", error);
    return json({ error: error.message }, { status: 500 });
  }
};

//Using SKU, fetch the product ID and title to display information to user
const getProductIdBySku = async (admin, sku) => {
  const productQuery = `
    query {
      products(first: 5, query: "sku:${sku}") {
        edges {
          node {
            id
            title
            createdAt
          }
        }
      }
    }
  `;

  const productResponse = await admin.graphql(productQuery);
  const productData = await productResponse.json();

  if (
    !productData.data ||
    !productData.data.products.edges.length
  ) {
    throw new Error(`Product not found for SKU: ${sku}`);
  }

  return productData.data.products.edges[0].node;
};

//Using fetched product ID, get inventory item ID of each product, which is 
//required in updateHsCode function query
const getInventoryItemId = async (admin, productId) => {
  const productQuery = `
    query {
      product(id: "${productId}") {
        variants(first: 10) {
          edges {
            node {
              inventoryItem {
                id
              }
            }
          }
        }
      }
    }
  `;

  const productResponse = await admin.graphql(productQuery);
  const productData = await productResponse.json();

  if (
    !productData.data ||
    !productData.data.product ||
    !productData.data.product.variants.edges.length
  ) {
    throw new Error(`Product or variants not found for product id: ${productId}`);
  }

  return productData.data.product.variants.edges[0].node.inventoryItem.id;
};

//Update the HS codes using Graphql mutation query
const updateHsCode = async (admin, inventoryItemId, hsCode) => {
  const mutationQuery = `
    mutation {
      inventoryItemUpdate(id: "${inventoryItemId}", input: { harmonizedSystemCode: "${hsCode}" }) {
        inventoryItem {
          id
          harmonizedSystemCode
        }
        userErrors {
          message
        }
      }
    }
  `;

  const mutationResponse = await admin.graphql(mutationQuery);
  const mutationResult = await mutationResponse.json();

  if (mutationResult.data.inventoryItemUpdate.userErrors.length > 0) {
    throw new Error(
      mutationResult.data.inventoryItemUpdate.userErrors[0].message
    );
  }

  return mutationResult.data.inventoryItemUpdate.inventoryItem;
};

//Manage action requests based on action type 
export const action = async ({ request }) => {
  try {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const products = JSON.parse(formData.get("products"));
    const actionType = formData.get("actionType");

    const failedUpdates = [];
    const detailedProducts = [];

    if (actionType === "fetchDetails") {
      for (const product of products) {
        const { sku, hsCode } = product;

        try {
          const productDetails = await getProductIdBySku(admin, sku);
          detailedProducts.push({
            title: productDetails.title,
            sku: product.sku,
            hsCode: product.hsCode,
            status: "Ok"
          });
        } catch (error) {
          console.error(`Error processing SKU: ${sku}, Error: ${error.message}`);
          detailedProducts.push({
            title: "Not Found",
            sku: product.sku,
            hsCode: product.hsCode,
            status: error.message
          });
          failedUpdates.push({ sku, error: error.message });
        }
      }
    } else if (actionType === "updateHsCodes") {
      for (const product of products) {
        const { sku, hsCode } = product;

        try {
          const productDetails = await getProductIdBySku(admin, sku);
          const inventoryItemId = await getInventoryItemId(admin, productDetails.id);
          await updateHsCode(admin, inventoryItemId, hsCode);
          detailedProducts.push({
            title: productDetails.title,
            sku: product.sku,
            hsCode: product.hsCode,
            status: "Updated"
          });
        } catch (error) {
          console.error(`Error processing SKU: ${sku}, Error: ${error.message}`);
          detailedProducts.push({
            title: "Not Found",
            sku: product.sku,
            hsCode: product.hsCode,
            status: error.message
          });
          failedUpdates.push({ sku, error: error.message });
        }
      }
    }

    return json({ success: true, detailedProducts, failedUpdates });
  } catch (error) {
    console.error("Error in action function:", error);
    return json({ error: error.message }, { status: 500 });
  }
};

//Validate csv file
const validateCsvFile = (file, setError) => {
  return new Promise((resolve, reject) => {
    if (file.type !== "text/csv" && !file.name.endsWith(".csv")) {
      setError("Please upload a valid CSV file.");
      return reject("Invalid file type");
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;

      if (content.trim() === "") {
        setError("The uploaded file is empty.");
        return reject("Empty file");
      }

      Papa.parse(content, {
        header: true,
        complete: (results) => {
          const { data, meta } = results;

          if (!meta.fields || !meta.fields.includes("sku") || !meta.fields.includes("hsCode")) {
            setError('The CSV file must contain "sku" and "hsCode" columns.');
            return reject("Missing required columns");
          }

          const productList = data
            .map((row) => ({
              sku: row.sku && row.sku.trim(),
              hsCode: row.hsCode && row.hsCode.trim(),
            }))
            .filter((product) => product.sku && product.hsCode);

          if (productList.length === 0) {
            setError("The CSV file does not contain any valid product data.");
            return reject("No valid products");
          }

          resolve(productList);
        },
        error: (error) => {
          setError("Error parsing CSV file.");
          return reject(error.message);
        },
      });
    };
    reader.readAsText(file);
  });
};

//Handlers and UI 
export default function Index() {
  const { appInstallationId } = useLoaderData();
  const [error, setError] = useState(null);
  const actionData = useActionData();
  const submit = useSubmit();
  const [csvFile, setCsvFile] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [updateCompleted, setUpdateCompleted] = useState(false);


  const resetState = () => {
    setCsvFile(null);
    setProducts([]);
    setLoading(false);
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      resetState();
      setLoading(true);
      validateCsvFile(file, setError)
        .then((productList) => {
          setCsvFile(file);
          setProducts(productList);
          setLoading(false);

          // Submit to fetch product details
          const formData = new FormData();
          formData.append("products", JSON.stringify(productList));
          formData.append("actionType", "fetchDetails");
          submit(formData, { method: "post" });
        })
        .catch(() => {
          setLoading(false);
        });
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    setUpdateCompleted(false); // Set this to false before starting the update
  
    const formData = new FormData();
    formData.append("products", JSON.stringify(products));
    formData.append("actionType", "updateHsCodes");
  
    try {
      await submit(formData, { method: "post" }); // This will trigger the action and await its completion
      setUpdateCompleted(true); // Update completed successfully
    } catch (error) {
      console.error("Error in handleSubmit:", error);
      setError("Failed to update HS codes.");
    } finally {
      setLoading(false); // Set loading to false only after the process completes
    }
  };
  
  const rows = actionData?.detailedProducts?.map((product) => [
    product.title,
    product.sku,
    product.hsCode,
    product.status,
  ]) || products.map((product) => ["Fetching...", product.sku, product.hsCode, ""]);

  return (
    <Page>
      <TitleBar title="Bulk Update HS Codes" />
      <Layout>
        <Layout.Section>
          {error && (
            <Banner status="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          )}
          <Card sectioned>            
        <BlockStack>
          <Text as="h2" variant="headingMd">
            This tool helps in updating HS codes for products in bulk.
          </Text>
          <p>
            To proceed, upload a .csv file containing columns: "sku" and "hsCode".
            The sku column should contain product sku's and the hsCode column should
            contain the new HS codes for respective products.
          </p>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "20px" }}>
            <Button onClick={() => document.getElementById("csvUpload").click()}>
              Upload CSV
            </Button>
            <Button
                onClick={handleSubmit}
                primary
                disabled={loading || products.length === 0 || updateCompleted}
              >
                {loading ? (
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <Spinner size="small" color="white" /> &nbsp; Updating...
                  </div>
                ) : (
                  "Update HS Codes"
                )}
              </Button>


            <input
              type="file"
              id="csvUpload"
              accept=".csv"
              style={{ display: "none" }}
              onChange={handleFileUpload}
              disabled={loading}
            />
          </div>
        </BlockStack>

        
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card title="Product Details">
            <DataTable
              columnContentTypes={["text", "text", "text", "text"]}
              headings={["Product Title", "SKU", "New HS Code", "Status"]}
              rows={rows}
            />
          </Card>
        </Layout.Section>
        {actionData?.failedUpdates?.length > 0 && (
          <Layout.Section>
            <Banner status="warning" title="Failures">
              <ul>
                {actionData.failedUpdates.map(({ sku, error }) => (
                  <li key={sku}>
                    SKU: {sku}, Error: {error}
                  </li>
                ))}
              </ul>
            </Banner>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
