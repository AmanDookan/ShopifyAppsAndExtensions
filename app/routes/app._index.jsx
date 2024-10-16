import React, { useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Button,
  Text,
  Modal,
  TextField,
  Spinner,
  Banner,
  ProgressBar,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import Papa from "papaparse";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, Form, useActionData } from "@remix-run/react";
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

    const metafieldsResponse = await admin.graphql(`
      query AppInstallationMetafields {
        appInstallation(id: "${appInstallationId}") {
          metafields(first: 50, namespace: "Customer_Tagging") {
            edges {
              node {
                id
                value
              }
            }
          }
        }
      }
    `);

    const metafieldsResult = await metafieldsResponse.json();
    const blacklistedTags = metafieldsResult.data.appInstallation.metafields.edges.length > 0
      ? JSON.parse(metafieldsResult.data.appInstallation.metafields.edges[0].node.value)
      : [];

    return json({ appInstallationId, blacklistedTags });
  } catch (error) {
    console.error("Error in loader function:", error);
    return json({ error: error.message }, { status: 500 });
  }
};

export const action = async ({ request }) => {
  try {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const actionType = formData.get("actionType");
    const emails = JSON.parse(formData.get("emails"));
    const tags = formData.get("tags").split(",").map((tag) => tag.trim());
    const blacklistedTags = JSON.parse(formData.get("blacklistedTags"));

    const intersectedTags = tags.filter(tag => blacklistedTags.includes(tag));
    if (intersectedTags.length > 0) {
      return json({ error: `The following tags are blacklisted and cannot be used: ${intersectedTags.join(', ')}` }, { status: 400 });
    }

    let response = [];
    
    if (actionType === "add") {
      response = await handleTags(emails, tags, admin, addTagsToCustomer);
    } else {
      response = await handleTags(emails, tags, admin, removeTagsFromCustomer);
    }

    return json({ success: true, failedEmails: response });
  } catch (error) {
    console.error("Error in action function:", error);
    return json({ error: error.message }, { status: 500 });
  }
};

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

          if (!meta.fields || !meta.fields.includes("email")) {
            setError('The CSV file must contain an "email" column.');
            return reject("Missing email column");
          }

          if (meta.fields.length > 1) {
            setError('The CSV file should only contain the "email" column.');
            return reject("Multiple columns");
          }

          const emailList = data
            .map((row) => row.email && row.email.trim())
            .filter((email) => email && email !== "");

          if (emailList.length === 0) {
            setError("The CSV file does not contain any valid email addresses.");
            return reject("No valid emails");
          }

          resolve(emailList);
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

const handleTags = async (emails, tagsArray, admin, action) => {
  const batchSize = 5;

  let failedEmails = [];

  for (let i = 0; i < emails.length; i += batchSize) {
    const batchedEmails = emails.slice(i, i + batchSize);
    const response = await executeBatchedRequests(batchedEmails, tagsArray, admin, action);
    response.forEach((item) => {
      failedEmails.push(item);
    })
  }
  return failedEmails;
};

const executeBatchedRequests = async (batchedEmails, tagsArray, admin, action) => {
  try {
    const customerIds = await Promise.all(batchedEmails.map(email => getCustomerIdByEmail(email, admin)));

    const validCustomerIds = [];
    const failed = [];
    batchedEmails.forEach((email, index) => {
      if (customerIds[index]) {
        validCustomerIds.push(customerIds[index]);
      } else {
        failed.push(email);
      }
    });

    await Promise.all(validCustomerIds.map(customerId => action(customerId, tagsArray, admin)));
    return failed;
  } catch (error) {
    throw new Error("An error occurred during the request execution.");
  }
  return [];
};

const getCustomerIdByEmail = async (email, admin) => {
  const resp = await admin.graphql(`
      query($query: String!) {
        customers(first: 10, query: $query) {
          edges {
            node {
              id
              email
            }
          }
        }
      }
    `,
    {
      variables: {query:email}
    }
  );

  const response = await resp.json();
  console.log("----------------------------------------");
  console.log(response.data.customers.edges);
  if (response.data.customers.edges.length > 0) {
    return response.data.customers.edges[0].node.id;
  } else {
    return null;
  }
};

const addTagsToCustomer = async (customerId, tagsArray, admin) => {
  const mutation = `
    mutation addTags {
      tagsAdd(id: "${customerId}", tags: "${tagsArray}") {
        node {
          id
        }
        userErrors {
          message
        }
      }
    }
  `;

  const response = await admin.graphql(mutation);

  if (response.errors) {
    throw new Error("GraphQL request failed");
  }

  return response.data;
};

const removeTagsFromCustomer = async (customerId, tagsArray, admin) => {
  const mutation = `
    mutation removeTags {
      tagsRemove(id: "${customerId}", tags: "${tagsArray}") {
        userErrors {
          message
        }
        node {
          id
        }
      }
    }
  `;

  const response = await admin.graphql(mutation);

  if (response.errors) {
    throw new Error(response.errors);
  }

  return response.data;
};

export default function Index() {
  const { blacklistedTags } = useLoaderData();
  const [error, setError] = useState(null);
  const actionData = useActionData();
  const submit = useSubmit();
  const [csvFile, setCsvFile] = useState(null);
  const [emails, setEmails] = useState([]);
  const [active, setActive] = useState(false);
  const [tags, setTags] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState([]);
  const [success, setSuccess] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lastUploadedFileName, setLastUploadedFileName] = useState(null);
  const [previousFileName, setPreviousFileName] = useState(null);
  const [currentFileName, setCurrentFileName] = useState(null);
  const [duplicateError, setDuplicateError] = useState(false);

  const resetState = () => {
    setCsvFile(null);
    setEmails([]);
    setActive(false);
    setTags("");
    setLoading(false);
    setErrors([]);
    setSuccess(false);
    setProgress(0);
    setDuplicateError(false);
    setPreviousFileName(null);
    setCurrentFileName(null);
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      if (file.name === lastUploadedFileName) {
        setDuplicateError(true);
        setPreviousFileName(lastUploadedFileName);
        setCurrentFileName(file.name);
        event.target.value = "";
        return;
      }
      resetState();
      setDuplicateError(false);
      setLoading(true);
      validateCsvFile(file, setError)
        .then((emailList) => {
          setCsvFile(file);
          setEmails(emailList);
          setActive(true);
          setLoading(false);
          setLastUploadedFileName(file.name);
          event.target.value = "";
        })
        .catch((error) => {
          setLoading(false);
        });
    }
  };

  const handleModalChange = () => setActive(!active);
  const handleTagsChange = (value) => setTags(value);

  const handleAddTagsSubmit = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    const intersectedTags = tags.split(",").map(tag => tag.trim()).filter(tag => blacklistedTags.includes(tag));
    if (intersectedTags.length > 0) {
      setError(`The following tags are blacklisted and cannot be used: ${intersectedTags.join(', ')}`);
      setLoading(false);
      return;
    }

    const formData = new FormData();
    formData.append("emails", JSON.stringify(emails));
    formData.append("tags", tags);
    formData.append("actionType", "add");
    formData.append("blacklistedTags", JSON.stringify(blacklistedTags));

    try {
      await submit(formData, { method: "post" });
      setSuccess(true);
    } catch (error) {
      console.error("Error in handleSubmit:", error);
      setError("Failed to save changes.");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveTagsSubmit = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    const intersectedTags = tags.split(",").map(tag => tag.trim()).filter(tag => blacklistedTags.includes(tag));
    if (intersectedTags.length > 0) {
      setError(`The following tags are blacklisted and cannot be used: ${intersectedTags.join(', ')}`);
      setLoading(false);
      return;
    }

    const formData = new FormData();
    formData.append("emails", JSON.stringify(emails));
    formData.append("tags", tags);
    formData.append("actionType", "remove");
    formData.append("blacklistedTags", JSON.stringify(blacklistedTags));

    try {
      await submit(formData, { method: "post" });
      setSuccess(true);
    } catch (error) {
      console.error("Error in handleSubmit:", error);
      setError("Failed to save changes.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Page>
      <TitleBar title="Add/Remove Tags to Customers in Bulk" />
      <Layout>
        <Layout.Section>
          <Card sectioned>
            <BlockStack>
              <Text as="h2" variant="headingMd">
                The app helps in adding/removing tags to customers in bulk.
              </Text>
              <p>
                To proceed, upload a .csv file containing a column header
                "email" which has the list of emails for respective users to
                which you want to add/remove tags. To provide multiple tags,
                separate them by using comma ',' as a delimiter.
              </p>
              <div style={{ marginTop: "20px" }}>
                <Button onClick={() => document.getElementById("csvUpload").click()}>
                  Upload CSV
                </Button>
                <input
                  type="file"
                  id="csvUpload"
                  accept=".csv"
                  style={{ display: "none" }}
                  onChange={handleFileUpload}
                />
                {loading && !active && <Spinner size="small" color="teal" />}
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {error && (
        <Layout.Section>
          <Banner title="Error" status="critical">
            {error}
          </Banner>
        </Layout.Section>
      )}

      {duplicateError && (
        <Layout.Section>
          <Banner title="Duplicate File" status="warning">
            You have already uploaded this file: <br />
            Previous file : <b>{previousFileName}.</b> <br />
            Current file : <b>{currentFileName}.</b>
          </Banner>
        </Layout.Section>
      )}

      {active && (
        <Modal
          key={csvFile ? csvFile.name : "modal"}
          open={active}
          onClose={handleModalChange}
          title="Add/Remove Tags"
          primaryAction={{
            content: "Add Tags",
            onAction: handleAddTagsSubmit,
          }}
          secondaryActions={[
            {
              content: "Remove Tags",
              onAction: handleRemoveTagsSubmit,
            },
          ]}
        >
          <Modal.Section>
            <TextField
              label="Tags (comma separated)"
              value={tags}
              onChange={handleTagsChange}
              autoComplete="off"
            />
          </Modal.Section>
          {loading && (
            <Modal.Section>
              <ProgressBar progress={progress} size="medium" />
            </Modal.Section>
          )}
        </Modal>
      )}

      {actionData?.failedEmails.length > 0 && (
        <Layout.Section>
          <Card sectioned>
            <BlockStack>
              <p>The following emails were not found:</p>
              <ul>
                {actionData?.failedEmails.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </BlockStack>
          </Card>
        </Layout.Section>
      )}

      {success && errors.length === 0 && (
        <Layout.Section>
          <Card sectioned>
            <BlockStack>
              <Banner title="Success" status="success">
                The emails found are successfully processed.
              </Banner>
            </BlockStack>
          </Card>
        </Layout.Section>
      )}
    </Page>
  );
}
