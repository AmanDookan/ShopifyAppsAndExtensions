import React, { useState, useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack ,
  Button,
  TextField,
  Banner,
  Backdrop,
} from "@shopify/polaris";
import { useLoaderData, useSubmit } from "@remix-run/react";
import { json } from "@remix-run/node";
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
    const appInstallationId = formData.get("appInstallationId");
    const blacklistedTags = formData.get("blacklistedTags");

    const metafieldsSetInput = {
      namespace: "Customer_Tagging",
      key: "Blacklisted_tags",
      type: "json",
      value: blacklistedTags,
      ownerId: appInstallationId,
    };

    const mutation = `
      mutation CreateAppDataMetafield {
        metafieldsSet(metafields: {
          namespace: "${metafieldsSetInput.namespace}",
          key: "${metafieldsSetInput.key}",
          type: "${metafieldsSetInput.type}",
          value: ${JSON.stringify(metafieldsSetInput.value)},
          ownerId: "${metafieldsSetInput.ownerId}"
        }) {
          metafields {
            id
            namespace
            key
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const submitResponse = await admin.graphql(mutation);
    const response = await submitResponse.json();

    if (response.data.metafieldsSet && response.data.metafieldsSet.userErrors.length > 0) {
      throw new Error(response.data.metafieldsSet.userErrors.map((e) => e.message).join(", "));
    }

    return json({ success: true });
  } catch (error) {
    console.error("Error in action function:", error);
    return json({ error: error.message }, { status: 500 });
  }
};

export default function BlacklistTagsPage() {
  const { appInstallationId, blacklistedTags: initialBlacklistedTags } = useLoaderData();
  const submit = useSubmit();
  const [blacklistedTags, setBlacklistedTags] = useState(initialBlacklistedTags || []);
  const [newTag, setNewTag] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [tagExistsError, setTagExistsError] = useState("");

  useEffect(() => {
    if (appInstallationId && initialBlacklistedTags === undefined) {
      fetchBlacklistedTags();
    }
  }, [appInstallationId, initialBlacklistedTags]);

  const fetchBlacklistedTags = async () => {
    try {
      const formData = new FormData();
      formData.append("appInstallationId", appInstallationId);

      const response = await submit(formData, { method: "get" });

      if (response.data.blacklistedTags) {
        setBlacklistedTags(response.data.blacklistedTags);
      }
    } catch (error) {
      console.error("Error fetching blacklisted tags:", error);
      setError("Failed to fetch blacklisted tags.");
    }
  };

  const handleAddTag = () => {
    const tagsToAdd = newTag.trim().split(",").map(tag => tag.trim());
    let newTags = [];

    tagsToAdd.forEach(tag => {
      if (tag !== "") {
        if (blacklistedTags.includes(tag)) {
          setTagExistsError(`Tag "${tag}" already exists in the blacklist.`);
        } else {
          newTags.push(tag);
        }
      }
    });

    // Add new tags to the blacklist
    if (newTags.length > 0) {
      setBlacklistedTags([...blacklistedTags, ...newTags]);
      setNewTag("");
      setTagExistsError("");
    }
  };


  const handleRemoveTag = (tagToRemove) => {
    setBlacklistedTags(blacklistedTags.filter((tag) => tag !== tagToRemove));
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);
  
    const formData = new FormData();
    formData.append("appInstallationId", appInstallationId);
    formData.append("blacklistedTags", JSON.stringify(blacklistedTags));
  
    try {
      await submit(formData, { method: "post", replace: true });
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
      <Layout>
        <Layout.Section>
          <Card sectioned>
            <BlockStack>
              <TextField
                label="Add Tag to Blacklist"
                value={newTag}
                onChange={(value) => {
                  setNewTag(value);
                  setTagExistsError("");
                }}
                placeholder="Enter a tag / multiple tags separated by comma ',' "
                error={tagExistsError}
              />
              <div style={{ width: "fit-content", marginTop: "10px" }}>
                <Button onClick={handleAddTag}>Add</Button>
              </div>
            </BlockStack>
            <div style={{ marginTop: "0px", textAlign: "right" }}>
              <Button primary onClick={handleSubmit} loading={loading}  
              style={{ boxShadow: "0px 0px 5px rgba(0, 0, 0, 0.1)", transition: "box-shadow 0.3s ease"}}>
                Save Changes
              </Button>
            </div>
          </Card>
        </Layout.Section>
        <Layout.Section>
          {blacklistedTags.length === 0 ? (
            <Card sectioned>
              <div>No tags are currently blacklisted.</div>
            </Card>
          ) : (
            <Card sectioned title="Blacklisted Tags">
              {blacklistedTags.map((tag, index) => (
                <div key={index} style={{ marginBottom: "10px" }}>
                  <span style={{ marginRight: "10px" }}>{tag}</span>
                  <Button onClick={() => handleRemoveTag(tag)} size="slim">
                    Remove
                  </Button>
                </div>
              ))}
            </Card>
          )}
        </Layout.Section>
        <Layout.Section>
          {error && (
            <Banner title="Error" status="critical">
              {error}
            </Banner>
          )}
          {success && (
            <Banner title="Success" status="success">
              Changes saved successfully.
            </Banner>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
