import React, { useState, useEffect, useCallback } from 'react';
import {
  Page,
  Card,
  FormLayout,
  Text,
  TextField,
  DatePicker,
  DataTable,
  Button,
  Modal,
  BlockStack,
  Checkbox,
  Select,
} from '@shopify/polaris';

import { useLoaderData, useFetcher } from '@remix-run/react';
import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';

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
          metafields(first: 100, namespace: "discounts") {
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
    const tagsAndSchedules = metafieldsResult.data.appInstallation.metafields.edges || [];

    let tagDiscounts = tagsAndSchedules.find(edge => edge.node.key === 'tagDiscounts');
    let scheduleDiscounts = tagsAndSchedules.find(edge => edge.node.key === 'scheduleDiscounts');

    if (!tagDiscounts) {
      tagDiscounts = { node: { key: 'tagDiscounts', value: JSON.stringify([]) } };
    }
    if (!scheduleDiscounts) {
      scheduleDiscounts = { node: { key: 'scheduleDiscounts', value: JSON.stringify([]) } };
    }

    return json({ appInstallationId, tagDiscounts, scheduleDiscounts });
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
    const updatedTagDiscounts = JSON.parse(formData.get('updatedTagDiscounts'));
    const updatedScheduleDiscounts = JSON.parse(formData.get('updatedScheduleDiscounts'));

    const metafieldsSetInputTagDiscounts = {
      namespace: "discounts",
      key: "tagDiscounts",
      type: "json",
      value: JSON.stringify(updatedTagDiscounts),
      ownerId: appInstallationId,
    };

    const metafieldsSetInputScheduleDiscounts = {
      namespace: "discounts",
      key: "scheduleDiscounts",
      type: "json",
      value: JSON.stringify(updatedScheduleDiscounts),
      ownerId: appInstallationId,
    };

    const mutation = `
      mutation CreateAppDataMetafield {
        metafieldsSet(metafields: [
          {
            namespace: "${metafieldsSetInputTagDiscounts.namespace}",
            key: "${metafieldsSetInputTagDiscounts.key}",
            type: "${metafieldsSetInputTagDiscounts.type}",
            value: ${JSON.stringify(metafieldsSetInputTagDiscounts.value)},
            ownerId: "${metafieldsSetInputTagDiscounts.ownerId}"
          },
          {
            namespace: "${metafieldsSetInputScheduleDiscounts.namespace}",
            key: "${metafieldsSetInputScheduleDiscounts.key}",
            type: "${metafieldsSetInputScheduleDiscounts.type}",
            value: ${JSON.stringify(metafieldsSetInputScheduleDiscounts.value)},
            ownerId: "${metafieldsSetInputScheduleDiscounts.ownerId}"
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

    return json({ success: true });
  } catch (error) {
    console.error('Error in action function:', error);
    return json({ error: error.message }, { status: 500 });
  }
};


export default function ManageDiscounts() {
  const { tagDiscounts, scheduleDiscounts, appInstallationId } = useLoaderData();
  const fetcher = useFetcher();

  const existingTagDiscounts = tagDiscounts ? JSON.parse(tagDiscounts.node.value) : [];
  const existingScheduleDiscounts = scheduleDiscounts ? JSON.parse(scheduleDiscounts.node.value) : [];
  const [stagedTagDiscounts, setStagedTagDiscounts] = useState(existingTagDiscounts);
  const [stagedScheduleDiscounts, setStagedScheduleDiscounts] = useState(existingScheduleDiscounts);
  const [tag, setTag] = useState('');
  const [isD12C, setIsD12C] = useState(false);
  const [tagDiscountCode, setTagDiscountCode] = useState('');
  const [tagDiscountPercentage, setTagDiscountPercentage] = useState('');
  const [scheduleDiscountCode, setScheduleDiscountCode] = useState('');
  const [scheduleDiscountPercentage, setScheduleDiscountPercentage] = useState('');
  const [modalActive, setModalActive] = useState(false);
  const [modalActiveSchedule, setModalActiveSchedule] = useState(false);
  const toggleModal = useCallback(() => setModalActive((active) => !active), []);
  
  const toggleModalSchedule = useCallback(() => setModalActiveSchedule((active) => !active), []);
  
  const [selectedTag, setSelectedTag] = useState('');
  const [scheduleDate, setScheduleDate] = useState({ start: new Date(), end: new Date() });

    
  const [{ month, year }, setDate] = useState({
    month: new Date().getMonth(),
    year: new Date().getFullYear(),
  });
  const [selectedDate, setSelectedDate] = useState({ start: new Date(), end: new Date() });
  const [isSaveEnabled, setIsSaveEnabled] = useState(false);

  useEffect(() => {
    const hasTagDiscountChanges = JSON.stringify(existingTagDiscounts) !== JSON.stringify(stagedTagDiscounts);
    const hasScheduleDiscountChanges = JSON.stringify(existingScheduleDiscounts) !== JSON.stringify(stagedScheduleDiscounts);
    setIsSaveEnabled(hasTagDiscountChanges || hasScheduleDiscountChanges);
  }, [existingTagDiscounts, stagedTagDiscounts, existingScheduleDiscounts, stagedScheduleDiscounts]);

  const validateTag = (tag) => {
    return /^[A-Z0-9_]+$/.test(tag) && !/\s/.test(tag);
  };
  
  const validateDiscountCode = (discountCode, discountPercentage) => {
    if (discountCode.length < 3) {
      return false;
    }
  
    const lastTwoChars = discountCode.slice(-2);
    const lastTwoDigits = parseInt(lastTwoChars, 10);
  
    if (discountPercentage.length === 1) {
      const singleDigitDiscount = parseInt(discountPercentage, 10);
      return !isNaN(lastTwoDigits) && lastTwoDigits === singleDigitDiscount;
    } else if (discountPercentage.length === 2) {
      const doubleDigitDiscount = parseInt(discountPercentage.slice(-2), 10);
      return !isNaN(lastTwoDigits) && lastTwoDigits === doubleDigitDiscount;
    }
  
    return false;
  };
    const tagDiscountRows = stagedTagDiscounts.map((discount, index) => [
        discount.tag,
        discount.discountCode,
        discount.discountPercentage,
        discount.isD12C ? 'Yes' : 'No',
        <Button onClick={() => handleRemoveTagDiscount(index)} destructive>Remove</Button>,
      ]);
    
    
      const scheduleDiscountRows = stagedScheduleDiscounts.map((discount, index) => [
        `${new Date(discount.date).toLocaleDateString()}`,
        discount.tag,
        discount.discountCode,
        discount.discountPercentage,
        discount.isD12C ? 'Yes' : 'No',
        <Button onClick={() => handleRemoveScheduleDiscount(index)} destructive>Remove</Button>,
      ]);
      
  

    const handleAddTagDiscount = () => {
      if (!tag || !tagDiscountCode || !tagDiscountPercentage) {
        shopify.toast.show('All fields are required');
        return;
      }
      if (isNaN(tagDiscountPercentage) || tagDiscountPercentage > 25) {
        shopify.toast.show('Discount percentage must be a number and not more than 25');
        return;
      }
      if (!validateTag(tag)) {
        shopify.toast.show('Tag should be in all uppercase without spaces, underscores are allowed');
        return;
      }
      if (!validateDiscountCode(tagDiscountCode, tagDiscountPercentage)) {
        shopify.toast.show('Discount code should have minimum 3 characters, last two characters should be digits and match the discount percentage');
        return;
      }
      const tagExists = stagedTagDiscounts.some(discount => discount.tag === tag);
      if (tagExists) {
        shopify.toast.show('Tag already exists');
        return;
      }
      setStagedTagDiscounts([...stagedTagDiscounts, { tag, discountCode: tagDiscountCode, discountPercentage: tagDiscountPercentage, isD12C }]);
      setTag('');
      setTagDiscountCode('');
      setTagDiscountPercentage('');
      setIsD12C(false); // Reset checkbox
      toggleModal();
      shopify.toast.show('Tag discount added successfully');
    };
    
  const handleRemoveTagDiscount = (index) => {
    const updatedTagDiscounts = stagedTagDiscounts.filter((_, i) => i !== index);
    setStagedTagDiscounts(updatedTagDiscounts);
    shopify.toast.show('Tag discount removed successfully');
  };
  
  const handleAddScheduleTagDiscount = () => {
    if (!selectedTag || !scheduleDate.start) {
      shopify.toast.show('All fields are required');
      return;
    }
  
    const tagDiscount = existingTagDiscounts.find(discount => discount.tag === selectedTag);
    if (!tagDiscount) {
      shopify.toast.show('Selected tag is not valid');
      return;
    }
      // Check if the same discount tag with the same discount code and the same selected date already exists
      const existingSchedule = stagedScheduleDiscounts.find(discount =>
        discount.tag === selectedTag &&
        discount.discountCode === tagDiscount.discountCode &&
        discount.date === scheduleDate.start.toISOString()
      );

      if (existingSchedule) {
        shopify.toast.show('This schedule tag discount already exists');
        return;
      }
  
    setStagedScheduleDiscounts([
      ...stagedScheduleDiscounts,
      {
        tag: selectedTag,
        date: scheduleDate.start.toISOString(),
        discountCode: tagDiscount.discountCode,
        discountPercentage: tagDiscount.discountPercentage,
        isD12C: tagDiscount.isD12C,
      },
    ]);
  
    setSelectedTag('');
    setScheduleDate({ start: new Date(), end: new Date() });
    toggleModalSchedule();
    shopify.toast.show('Schedule tag discount added successfully');
  };
  
  
  const handleRemoveScheduleDiscount = (index) => {
    const updatedScheduleDiscounts = stagedScheduleDiscounts.filter((_, i) => i !== index);
    setStagedScheduleDiscounts(updatedScheduleDiscounts);
    shopify.toast.show('Schedule discount removed successfully');
  };
  

  const handleSaveChanges = () => {
    fetcher.submit(
      {
        updatedTagDiscounts: JSON.stringify(stagedTagDiscounts),
        updatedScheduleDiscounts: JSON.stringify(stagedScheduleDiscounts),
        appInstallationId,
      },
      { method: 'post' }
    );
    shopify.toast.show('Changes saved successfully');
    setIsSaveEnabled(false);
  };

  const handleDiscardChanges = () => {
    if (JSON.stringify(existingTagDiscounts) === JSON.stringify(stagedTagDiscounts) &&
        JSON.stringify(existingScheduleDiscounts) === JSON.stringify(stagedScheduleDiscounts)) {
      return;
    }

    setStagedTagDiscounts(existingTagDiscounts);
    setStagedScheduleDiscounts(existingScheduleDiscounts);
    setTag('');
    setDiscountCode('');
    setDiscountPercentage('');
    setSelectedDate({ start: new Date(), end: new Date() });
    shopify.toast.show('Changes discarded');
    setIsSaveEnabled(false);
  };

  const handleMonthChange = useCallback((month, year) => {
    setDate({ month, year });
  }, []);

  return (
    <Page
      title="Manage Discounts"
      primaryAction={{
        content: 'Save Changes',
        disabled: !isSaveEnabled,
        onAction: handleSaveChanges,
      }}
      secondaryActions={[
        {
          content: 'Discard Changes',
          disabled: !isSaveEnabled,
          onAction: handleDiscardChanges,
        },
      ]}
    >
      <Card sectioned>
        <FormLayout>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0px' }}>
          <Text variant="bodyLg" as="p" fontWeight='bold'>TAG DISCOUNTS</Text>
          <Button onClick={toggleModal}>Add Tag Discount</Button>
          </div>
          <BlockStack>
          <DataTable
            columnContentTypes={['text', 'text', 'text', 'text', 'text']}
            headings={[
              <Text variant="headingSm" as="span">Tag</Text>,
              <Text variant="headingSm" as="span">Discount Code</Text>,
              <Text variant="headingSm" as="span">Discount Percentage</Text>,
              <Text variant="headingSm" as="span">D12C</Text>,
              <Text variant="headingSm" as="span">Actions</Text>,
            ]}
            rows={tagDiscountRows}
          />

          </BlockStack>
        </FormLayout>
      </Card>
      <Card sectioned>
        <FormLayout>          
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0px' }}>
          <Text variant="bodyLg" as="p" fontWeight='bold'>SCHEDULE DISCOUNTS</Text>
          <Button onClick={toggleModalSchedule}>Add Schedule Tag Discount</Button>
          </div>
          <BlockStack>
            <DataTable
              columnContentTypes={['text', 'text', 'text', 'text', 'text']}
              headings={[
                <Text variant="headingSm" as="span">Date</Text>,
                <Text variant="headingSm" as="span">Tag</Text>,
                <Text variant="headingSm" as="span">Discount Code</Text>,
                <Text variant="headingSm" as="span">Discount Percentage</Text>,
                <Text variant="headingSm" as="span">D12C?</Text>,
                <Text variant="headingSm" as="span">Actions</Text>,
              ]}
              rows={scheduleDiscountRows}
            />
          </BlockStack>
        </FormLayout>
      </Card>
      
      <Modal
        open={modalActive}
        onClose={toggleModal}
        title="Add Tag Discount"
        primaryAction={{
          content: 'Add',
          onAction: handleAddTagDiscount,
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: toggleModal,
          },
        ]}
      >
      <Modal.Section>
          <FormLayout>
              <TextField
                label="Tag"
                value={tag}
                onChange={setTag}
                autoComplete="off"
              />
              <TextField
                label="Discount Code"
                value={tagDiscountCode}
                onChange={setTagDiscountCode}
                autoComplete="off"
              />
              <TextField
                label="Discount Percentage"
                value={tagDiscountPercentage}
                onChange={setTagDiscountPercentage}
                autoComplete="off"
              />
              <Checkbox
                label="D12C"
                checked={isD12C}
                onChange={setIsD12C}
              />
          </FormLayout>
        </Modal.Section>
      </Modal>
      <Modal
        open={modalActiveSchedule}
        onClose={toggleModalSchedule}
        title="Add Schedule Tag Discount"
        primaryAction={{
          content: 'Add',
          onAction: handleAddScheduleTagDiscount,
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: toggleModalSchedule,
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <Select
              label="Select Tag"
              options={existingTagDiscounts.map(discount => ({ label: discount.tag, value: discount.tag }))}
              value={selectedTag}
              onChange={setSelectedTag}
            />
            <DatePicker
              month={month}
              year={year}
              onChange={setScheduleDate}
              onMonthChange={handleMonthChange}
              selected={scheduleDate}
              allowRange={false}
            />
          </FormLayout>
        </Modal.Section>
      </Modal>

      
    </Page>
  );
}
