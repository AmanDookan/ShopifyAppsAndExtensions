import { useEffect, useState } from 'react';
import {
  reactExtension,
  useApi,
  AdminAction,
  BlockStack,
  Button,
  Text,
  Link,
} from '@shopify/ui-extensions-react/admin';

const TARGET = 'admin.order-details.action.render';  //Defines where the action will be targeted

export default reactExtension(TARGET, () => <App />);

function App() {
  const { i18n, close, data } = useApi(TARGET);
  const [metafieldValue, setMetafieldValue] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (data && data.selected && data.selected[0] && data.selected[0].id) {
      const orderId = data.selected[0].id;
      //Get the Invoice link stored in metafield
      (async function getOrderMetafield() {
        setLoading(true);

        const getMetafieldQuery = {
          query: `query {
            node(id: "${orderId}") {
              id
              ... on Order {
                metafield(namespace: "invoice", key: "link") {
                  value
                }
              }
            }
          }`,
        };

        try {
          const res = await fetch("shopify:admin/api/graphql.json", {
            method: "POST",
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${data.token}` 
            },
            body: JSON.stringify(getMetafieldQuery),
          });

          if (!res.ok) {
            throw new Error('Network response was not ok');
          }

          const metafieldData = await res.json();
          const metafieldValue = metafieldData?.data?.node?.metafield?.value || 'No metafield found';
          setMetafieldValue(metafieldValue);
        } catch (error) {
          console.error('Error fetching metafield:', error);
          setMetafieldValue('No metafield found');
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [data]);
  
  return (
    <AdminAction
      primaryAction={
        <Button
          onPress={() => {
            console.log('saving');
            close();
          }}
        >
          Done
        </Button>
      }
      secondaryAction={
        <Button
          onPress={() => {
            console.log('closing');
            close();
          }}
        >
          Close
        </Button>
      }
    >
      {/* Show loading, then render elements if invoice url is found */}
      <BlockStack>
        {loading ? (
          <Text>Loading...</Text>
        ) : metafieldValue && metafieldValue !== 'No metafield found' ? (
          <Button
            external
            target="_blank"
            primary
            href={metafieldValue}
          >
            View Invoice
          </Button>
        ) : (
          <Text>No invoice found</Text>
        )}
      </BlockStack>
    </AdminAction>
  );
}
