import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  reactExtension,
  useSelectedPaymentOptions,
  useCartLines,
  useAppMetafields,
  useApplyCartLinesChange,
  useSubtotalAmount,
  useBuyerJourney // Import the useBuyerJourney hook
} from '@shopify/ui-extensions-react/checkout';

export default reactExtension(
  'purchase.checkout.block.render',
  () => <Extension />,
);

function Extension() {
  const [selectedPaymentOption, setSelectedPaymentOption] = useState(null);
  const options = useSelectedPaymentOptions();
  const cartLines = useCartLines();
  const applyCartLinesChange = useApplyCartLinesChange();
  const subTotalAmount = useSubtotalAmount();
  const { intercept } = useBuyerJourney(); 
  const metafields = useAppMetafields();
  console.log(metafields);
  /*Logic to handle if initial subTotal amount is greater than 40
  Then use delete_if and pass the paymentMethodId*/
  
  /*Paypal payment disable handle ends here*/
   
  const previousPaymentOptionRef = useRef(null);
  const taxAmountRef = useRef(0); // Store tax amount to ensure stability

  const TAX_PRODUCT_ID = "gid://shopify/ProductVariant/48899550576961";
  const TAX_PERCENTAGE = 5;

  const taxQuantity = useMemo(() => {
    let totalTax = cartLines
      .filter(line => line.merchandise.id === TAX_PRODUCT_ID)
      .reduce((acc, line) => acc + line.cost.totalAmount.amount, 0);
    
    const subtotalExcludingTax = subTotalAmount.amount - totalTax;
        
    const taxAmount = (subtotalExcludingTax * TAX_PERCENTAGE) / 100;
    console.log("Tax Amount", taxAmount);
    taxAmountRef.current = taxAmount; // Store calculated tax amount in ref
    const final = Math.floor(taxAmount / 0.1);
    console.log("Tax Product Quantity", final);
    return final;
  }, [subTotalAmount.amount]);

  const handleResult = useCallback((result, action) => {
    if (result.type === 'success') {
      console.log(`${action} called: SUCCESS`);
    } else {
      console.error(`${action} failed:`, result.message);
    }
  }, []);

  const addOrUpdateTaxProducts = useCallback(async (quantity) => {
    const existingTaxProduct = cartLines.find(line => line.merchandise.id === TAX_PRODUCT_ID);

    if (existingTaxProduct) {
      if (existingTaxProduct.quantity !== quantity) {
        const result = await applyCartLinesChange({
          type: 'updateCartLine',
          id: existingTaxProduct.id,
          quantity: quantity,
        });
        handleResult(result, 'updateTaxProducts');
      }
    } else {
      const result = await applyCartLinesChange({
        type: 'addCartLine',
        merchandiseId: TAX_PRODUCT_ID,
        quantity: quantity,
      });
      handleResult(result, 'addTaxProducts');
    }
  }, [applyCartLinesChange, cartLines, handleResult]);

  const removeTaxProducts = useCallback(async () => {
    const taxProducts = cartLines.filter(line => line.merchandise.id === TAX_PRODUCT_ID);

    for (const taxProduct of taxProducts) {
      const result = await applyCartLinesChange({
        type: 'removeCartLine',
        id: taxProduct.id,
        quantity: taxProduct.quantity,
      });
      handleResult(result, 'removeTaxProducts');
    }
  }, [applyCartLinesChange, cartLines, handleResult]);

  // Use the intercept function to block checkout when tax products are being modified
  useEffect(() => {
    const setupInterceptor = async () => {
      const teardown = await intercept(async ({ activeStep, completed }) => {
        console.log('Intercept function called'); // Log message
        console.log('Active step:', activeStep); // Log current step
        console.log('Completed:', completed); // Log completion status

        if (activeStep === 'checkout' && !completed && taxAmountRef.current !== 0) {
          console.log('Blocking checkout due to tax product modification');
          return {
            behavior: 'block',
            reason: 'InvalidResultReason.InvalidExtensionState',
            errors: [{ message: 'Checkout is blocked while tax products are being modified.' }],
          };
        }
        return { behavior: 'allow' };
      });

      return () => teardown();
    };

    const teardownInterceptor = setupInterceptor();

    return () => {
      if (teardownInterceptor) teardownInterceptor();
    };
  }, [intercept]);

  useEffect(() => {
    // Check if payment option is 'wallet-paypal-express' before adding or updating tax products
    if (selectedPaymentOption === 'wallet-paypal-express') {
      if (taxQuantity === 0) { // Skip adding/updating with quantity 0 to avoid error
        return null;
      }
      const timeoutId = setTimeout(() => addOrUpdateTaxProducts(taxQuantity), 200);
      return () => clearTimeout(timeoutId);
    }
  }, [selectedPaymentOption, taxQuantity, addOrUpdateTaxProducts]);

  useEffect(() => {
    // Handle changes in payment options and remove tax products if switching away from 'wallet-paypal-express'
    const newOption = options.find(option => option.type === 'wallet' && option.handle === 'wallet-paypal-express')
      || options.find(option => option.handle !== selectedPaymentOption);

    if (newOption && newOption.handle !== selectedPaymentOption) {
      const previousPaymentOption = previousPaymentOptionRef.current;

      setSelectedPaymentOption(newOption.handle);
      previousPaymentOptionRef.current = newOption.handle;

      if (previousPaymentOption === 'wallet-paypal-express' && newOption.handle !== 'wallet-paypal-express') {
        removeTaxProducts();
      }
    }
  }, [options, selectedPaymentOption, removeTaxProducts]);

  return null;
}
