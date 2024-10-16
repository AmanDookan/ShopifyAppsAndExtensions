import React, { useState, useCallback } from 'react';
import {
  Page,
  Card,
  FormLayout,
  Text,
  TextField,
  DataTable,
  Button,
} from '@shopify/polaris';
import { useLoaderData, useFetcher } from '@remix-run/react';
import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';

export const loader = async ({ request }) => {
  try {
    const { admin } = await authenticate.admin(request);
    // Fetch shopify functions
    const shopifyFunctionsResponse = await admin.graphql(`
      query {
        shopifyFunctions(first: 25) {
          edges {
            node {
              id
              title
            }
          }
        }
      }
    `);
    const shopifyFunctionsResult = await shopifyFunctionsResponse.json();

    const cartCheckoutValidationFunction = shopifyFunctionsResult.data.shopifyFunctions.edges
      .find(edge => edge.node.title === "cart-checkout-validation");

    if (!cartCheckoutValidationFunction) {
      throw new Error('Shopify function with title "cart-checkout-validation" not found.');
    }

    const shopifyFunctionId = cartCheckoutValidationFunction.node.id;

    // Fetch validations
    const validationsResponse = await admin.graphql(`
      query {
        validations(first: 25) {
          edges {
            node {
              id
              shopifyFunction {
                id
                title
              }
            }
          }
        }
      }
    `);
    const validationsResult = await validationsResponse.json();

    // Find the validation associated with the Shopify function
    const validation = validationsResult.data.validations.edges
      .find(edge => edge.node.shopifyFunction.id === shopifyFunctionId);

    if (!validation) {
      throw new Error('Validation with "cart-checkout-validation" Shopify function not found.');
    }

    const validationId = validation.node.id;

    // Fetch the metafield on validation
    const metafieldResponse = await admin.graphql(`
      query {
        validation(id: "${validationId}") {
          metafield(namespace: "$app:checkout_validation", key: "config") {
            id
            namespace
            key
            type
            value
          }
        }
      }
    `);

    const metafieldResult = await metafieldResponse.json();
    const validationMetafield = metafieldResult.data.validation.metafield;

    return json({
      validationId,
      validationMetafield,
    });
  } catch (error) {
    console.error('Error in loader function:', error);
    return json({ error: error.message }, { status: 500 });
  }
};

export const action = async ({ request }) => {
  try {
    const { admin } = await authenticate.admin(request);

    const formData = await request.formData();

    const validationId = formData.get('validationId');
    const updatedCollectionData = JSON.parse(formData.get('updatedCollectionData'));

    if (!validationId) {
      throw new Error('Validation ID is missing.');
    }

    // Define metafield input
    const metafieldsSetInput = {
      namespace: "$app:checkout_validation",
      key: "config",
      ownerId: validationId,
      type: "json",
      value: JSON.stringify(updatedCollectionData),
    };

    // Mutation query with variables
    const mutation = `
      mutation SetMetafield($defs: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $defs) {
          metafields {
            id
            createdAt
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      defs: [metafieldsSetInput]
    };

    const submitResponse = await admin.graphql(mutation, { variables });
    const response = await submitResponse.json();

    if (response.data.metafieldsSet.userErrors.length > 0) {
      return json({ error: response.data.metafieldsSet.userErrors[0].message }, { status: 400 });
    }

    return json({ success: true, metafields: response.data.metafieldsSet.metafields });
  } catch (error) {
    console.error('Error in action function:', error);
    return json({ error: error.message }, { status: 500 });
  }
};

export default function AddCollections() {
  const { validationMetafield, validationId } = useLoaderData();
  const fetcher = useFetcher();

  const [updatedCollections, setUpdatedCollections] = useState(
    validationMetafield ? JSON.parse(validationMetafield.value).mapping : []
  );
  const [isSaveEnabled, setIsSaveEnabled] = useState(false);

  // Handle Quantity input for a specific collection
  const handleQuantityChange = useCallback(
    (newQuantity, collectionId) => {
      const updated = updatedCollections.map((collection) =>
        collection.collection === collectionId
          ? { ...collection, qty: newQuantity }
          : collection
      );
      setUpdatedCollections(updated);
      setIsSaveEnabled(true);
    },
    [updatedCollections]
  );

  // Handle adding new collection via resource picker
  const handleAddCollection = async () => {
    try {
      // Open Shopify resource picker for collections
      const selected = await shopify.resourcePicker({ type: 'collection' });
  
      if (selected?.selection?.length > 0) {
        const newCollectionId = selected.selection[0].id;
  
        // Check if the collection already exists
        const exists = updatedCollections.some(
          (collection) => collection.collection === newCollectionId
        );
  
        if (exists) {
          shopify.toast.show('This collection is already added.');
          return; // Exit if the collection already exists
        }
  
        const newEntry = { collection: newCollectionId, qty: '0' };
  
        // Update the collections array with the new entry
        setUpdatedCollections((prev) => [...prev, newEntry]);
        setIsSaveEnabled(true);
      }
    } catch (error) {
      console.error('Error selecting collection:', error);
    }
  };  
  

  // Handle removing a collection
  const handleRemoveCollection = useCallback(
    (collectionToRemove) => {
      const updated = updatedCollections.filter(
        ({ collection }) => collection !== collectionToRemove
      );
      setUpdatedCollections(updated);
      setIsSaveEnabled(updated.length > 0);
    },
    [updatedCollections]
  );

  // Handle saving changes
  const handleSaveChanges = useCallback(() => {
    fetcher.submit(
      {
        validationId,
        updatedCollectionData: JSON.stringify({
          collectionIds: updatedCollections.map(({ collection }) => collection),
          mapping: updatedCollections,
        }),
      },
      { method: 'post', action: '' }
    );
    setIsSaveEnabled(false);
  }, [validationId, updatedCollections, fetcher]);

  // Ensure updatedCollections is an array before mapping
  const rows = Array.isArray(updatedCollections)
  ? updatedCollections.map(({ collection, qty }) => [
      collection,
      <div key={collection} style={{ maxWidth: '100px' }}>
        <TextField
          value={qty}
          onChange={(value) => handleQuantityChange(value, collection)}
          type="number"
        />
      </div>,
      <Button
        key={`remove-${collection}`}
        onClick={() => handleRemoveCollection(collection)}
        destructive
      >
        Remove
      </Button>,
    ])
  : [];


  return (
    <Page
      title="Manage Collection ID"
      primaryAction={{
        content: 'Save Changes',
        disabled: !isSaveEnabled,
        onAction: handleSaveChanges,
      }}
      secondaryActions={[
        {
          content: 'Discard Changes',
          disabled: !isSaveEnabled,
          onAction: () => {
            setUpdatedCollections(JSON.parse(validationMetafield.value).mapping);
            setIsSaveEnabled(false);
          },
        },
      ]}
    >
      <Card sectioned>
        <FormLayout>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0px',
            }}
          >
            <Text variant="bodyLg" as="p" fontWeight="bold">
              COLLECTION ID'S
            </Text>
            <Button onClick={handleAddCollection}>Add Collection ID</Button>
          </div>
        </FormLayout>

        <DataTable
          columnContentTypes={['text', 'text', 'text']}
          headings={['Collection ID', 'Quantity', 'Actions']}
          rows={rows}
        />
      </Card>
    </Page>
  );
}
