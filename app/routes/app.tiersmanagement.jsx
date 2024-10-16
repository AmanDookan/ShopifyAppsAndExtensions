import React, { useState, useEffect } from 'react';
import {
  Page,
  Card,
  FormLayout,
  Text,
  TextField,
  Button,
  BlockStack,
  Select
} from '@shopify/polaris';
import { useLoaderData, useFetcher } from '@remix-run/react';
import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';

export const loader = async ({ request }) => {
  try {
    const { admin} = await authenticate.admin(request);
    
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
          metafields(first: 50, namespace: "gifts") {
            edges {
              node {
                key
                value
              }
            }
          }
        }
      }
    `);

    const metafieldsResult = await metafieldsResponse.json();

    const tiersAndGifts = metafieldsResult.data.appInstallation.metafields.edges;

    return json({ appInstallationId, tiersAndGifts });
  } catch (error) {
    console.error('Error in loader function:', error);
    return json({ error: error.message }, { status: 500 });
  }
};

export const action = async ({ request }) => {
  try {
    const { admin } = await authenticate.admin(request);

    const formData = await request.formData();
    const appInstallationId = formData.get('appInstallationId');
    const updatedTiers = JSON.parse(formData.get('updatedTiers'));
    const updatedGifts = JSON.parse(formData.get('updatedGifts'));
    const productId = formData.get('productId');
    
    // const productId = "gid://shopify/Product/9466966507841";
    // const collectionCount = await fetchProductCollectionsCount(admin, productId);
    // console.log(collectionCount);
    let collectionCount = [];
    if(productId){
      collectionCount = await fetchProductCollectionsCount(admin, productId);
    }
    
    const metafieldsSetInputTiers = {
      namespace: "gifts",
      key: "tiers",
      type: "json",
      value: JSON.stringify(updatedTiers),
      ownerId: appInstallationId,
    };

    const metafieldsSetInputGifts = {
      namespace: "gifts",
      key: "gifts",
      type: "json",
      value: JSON.stringify(updatedGifts),
      ownerId: appInstallationId,
    };

    const mutation = `
      mutation CreateAppDataMetafield {
        metafieldsSet(metafields: [
          {
            namespace: "${metafieldsSetInputTiers.namespace}",
            key: "${metafieldsSetInputTiers.key}",
            type: "${metafieldsSetInputTiers.type}",
            value: ${JSON.stringify(metafieldsSetInputTiers.value)},
            ownerId: "${metafieldsSetInputTiers.ownerId}"
          },
          {
            namespace: "${metafieldsSetInputGifts.namespace}",
            key: "${metafieldsSetInputGifts.key}",
            type: "${metafieldsSetInputGifts.type}",
            value: ${JSON.stringify(metafieldsSetInputGifts.value)},
            ownerId: "${metafieldsSetInputGifts.ownerId}"
          }
        ]) {
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
    
    if (response.data.metafieldsSet.userErrors.length > 0) {
      return json({ error: response.data.metafieldsSet.userErrors[0].message }, { status: 400 });
    }

    return json({ success: true, collectionCount });
  } catch (error) {
    console.error('Error in action function:', error);
    return json({ error: error.message }, { status: 500 });
  }
};

const fetchProductCollectionsCount = async (admin, productId) => {
  const query = `
    {
      product(id: "${productId}") {
        collections(first: 50) {
          edges {
            node {
              title
            }
          }
        }
      }
    }
  `;
  const response = await admin.graphql(query);
  const data = await response.json();
  return data.data.product.collections.edges.length;
};

export default function ManageTiersAndGifts() {
  const { tiersAndGifts, appInstallationId } = useLoaderData();
  const fetcher = useFetcher();
  
  const tiers = tiersAndGifts.find(edge => edge.node.key === 'tiers') || {};
  const gifts = tiersAndGifts.find(edge => edge.node.key === 'gifts') || {};
  

  const existingTiers = tiers ? JSON.parse(tiers.value || '[]') : [];
const existingGifts = gifts ? JSON.parse(gifts.value || '[]') : [];

  const [stagedTiers, setStagedTiers] = useState(existingTiers);
  const [stagedGifts, setStagedGifts] = useState(existingGifts);
  const [tierValue, setTierValue] = useState('');
  const [tierLabel, setTierLabel] = useState('');
  const [tierImageUrl, setTierImageUrl] = useState('');
  const [selectedTier, setSelectedTier] = useState('');
  const [isSaveEnabled, setIsSaveEnabled] = useState(false);

  useEffect(() => {
    // Check if there are staged changes
    const hasTierChanges = JSON.stringify(existingTiers) !== JSON.stringify(stagedTiers);
    const hasGiftChanges = JSON.stringify(existingGifts) !== JSON.stringify(stagedGifts);
    setIsSaveEnabled(hasTierChanges || hasGiftChanges);
  }, [existingTiers, stagedTiers, existingGifts, stagedGifts]);

  const handleAddTier = () => {
    if (!tierValue || !tierLabel || !tierImageUrl) {
      shopify.toast.show('All fields are required');
      return;
    }
    if (isNaN(tierValue)) {
      shopify.toast.show('Tier value must be a number');
      return;
    }

    const tierExists = stagedTiers.some(tier => tier.value === tierValue);

    if (tierExists) {
      shopify.toast.show('Tier already exists');
      return;
    }

    setStagedTiers([...stagedTiers, { value: tierValue, label: tierLabel, image: tierImageUrl }]);
    setTierValue('');
    setTierLabel('');
    setTierImageUrl('');
    shopify.toast.show('Tier added successfully');
  };

  const handleRemoveTier = (index) => {
    const updatedTiers = stagedTiers.filter((_, i) => i !== index);
    setStagedTiers(updatedTiers);
    shopify.toast.show('Tier removed successfully');
  };

  const handleSaveChanges = () => {
    fetcher.submit(
      {
        updatedTiers: JSON.stringify(stagedTiers),
        updatedGifts: JSON.stringify(stagedGifts),
        appInstallationId,
      },
      { method: 'post' }
    );
    shopify.toast.show('Changes saved successfully');
    setIsSaveEnabled(false);
  };

  const handleDiscardChanges = () => {
    if (JSON.stringify(existingTiers) === JSON.stringify(stagedTiers) &&
        JSON.stringify(existingGifts) === JSON.stringify(stagedGifts)) {
      // No changes, return or show message if desired
      return;
    }

    setStagedTiers(existingTiers);
    setStagedGifts(existingGifts);
    setTierValue('');
    setTierLabel('');
    setTierImageUrl('');
    shopify.toast.show('Changes discarded');
    setIsSaveEnabled(false);
  };

  const handleTierChange = (value) => {
    setSelectedTier(value);
  };

  const handleAddGift = async () => {
    if (!selectedTier) {
      shopify.toast.show('Please select a tier');
      return;
    }

    try {
      const selected = await shopify.resourcePicker({
        type: 'product'
      });

      // Handle selected product from resource picker
      // console.log('Selected Product:', selected);
      const selectedProduct = selected.selection[0];
      const productId = selectedProduct.id;
      const imageUrl = selectedProduct.images.length > 0 ? selectedProduct.images[0].originalSrc : ''; // Assuming you want the first image's URL
      const value = selectedProduct.variants[0].price; // Assuming you want the price of the first variant
      const title = selectedProduct.title;
      
        // Check if the same gift is already added
      const giftExists = stagedGifts.some(gift => gift.productId === productId && gift.tier === selectedTier);

      if (giftExists) {
        shopify.toast.show('This gift is already added to the selected tier');
        return;
      }    
      // Check if product belongs to multiple collections
      if(selected && productId){
        fetcher.submit(
          {
            updatedTiers: JSON.stringify(stagedTiers),
            updatedGifts: JSON.stringify(stagedGifts),
            appInstallationId,
            productId // Pass productId to action function
          },
          { method: 'post' }
        );
      }
      const response = await fetcher.data;
      
      if(response && response.collectionCount > 1){
        shopify.toast.show('Product belongs to collections');
        return;  
      }
      //If passed all checks, then Store the extracted values in state
      setStagedGifts([...stagedGifts, { tier: selectedTier, productId, image: imageUrl, value, title }]);    
      shopify.toast.show('Gift added successfully');  
      
    } catch (error) {
      console.error('Error selecting product:', error);
      shopify.toast.show('Error selecting product');
    }
  };

  const handleRemoveGift = (index) => {
    const updatedGifts = stagedGifts.filter((_, i) => i !== index);
    setStagedGifts(updatedGifts);
    shopify.toast.show('Gift removed successfully');
  };

  return (
    <Page
      title="Manage Tiers and Gifts"
      primaryAction={{
        content: 'Save Changes',
        disabled: !isSaveEnabled,
        onAction: handleSaveChanges
      }}
      secondaryActions={[
        {
          content: 'Discard Changes',
          disabled: !isSaveEnabled,
          onAction: handleDiscardChanges
        }
      ]}
    >
      {/* Top Section */}
      <Card sectioned>
        <FormLayout>
          <Text variant="bodyLg" as="p" fontWeight='bold'>TIERS</Text>
          <BlockStack>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px', gap: '10px' }}>
              <TextField
                label="Tier Value"
                value={tierValue}
                onChange={(value) => {
                  setTierValue(value);
                }}
                autoComplete="off"
                style={{ flex: '1', marginRight: '10px' }}
              />
              <TextField
                label="Tier Label"
                value={tierLabel}
                onChange={(value) => {
                  setTierLabel(value);
                }}
                autoComplete="off"
                style={{ flex: '1', marginRight: '10px' }}
              />
              <TextField
                label="Image URL"
                value={tierImageUrl}
                onChange={(value) => {
                  setTierImageUrl(value);
                }}
                autoComplete="off"
                style={{ flex: '1', marginRight: '10px' }}
              />
              <div style={{ marginTop: '25px' }}>
                <Button primary onClick={handleAddTier} style={{ marginTop: '5px'}}>
                  Add Tier
                </Button>
              </div>
            </div>
          </BlockStack>
          <BlockStack>
            {stagedTiers.map((tier, index) => (
              <div key={index} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ flex: 1, marginRight: '10px' }}>
                  <strong>Name:</strong> {tier.label} <br />
                </div>
                <Button onClick={() => handleRemoveTier(index)} destructive >
                  Remove
                </Button>
              </div>
            ))}
          </BlockStack>
        </FormLayout>
      </Card>

      {/* Bottom Section */}
      <Card sectioned>
        <FormLayout>
          <Text variant="bodyLg" as="p" fontWeight='bold'>FREE GIFTS</Text>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px', gap: '10px' }}>
          <Select
            label="Select Tier"
            options={[{ label: 'Select a tier', value: '' }, ...stagedTiers.map(tier => ({ label: tier.label, value: tier.value }))]}
            onChange={handleTierChange}
            value={selectedTier}
          />
           <div style={{ marginTop: '25px' }}>
            <Button primary onClick={handleAddGift} disabled={!selectedTier} style={{ marginTop: '5px'}} >
              Add Gift
            </Button>
            </div>
          </div>
          <BlockStack>
          {stagedGifts
            .filter(gift => gift.tier === selectedTier)
            .map((gift, index) => (
              <div key={index} style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
                <img src={gift.image} alt={gift.title} style={{ maxWidth: '70px', marginRight: '10px' }} />
                <div style={{ flexGrow: 1 }}>
                  <strong>Gift:</strong> {gift.title} - <strong>Value:</strong> {gift.value}
                </div>
                <Button onClick={() => handleRemoveGift(index)} destructive>
                  Remove
                </Button>
              </div>
            ))}
        </BlockStack>

        </FormLayout>
      </Card>
    </Page>
  );
}