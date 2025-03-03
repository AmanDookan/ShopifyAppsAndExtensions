use shopify_function::prelude::*;
use shopify_function::Result;

/*
 --------------------------CONFIGURATION FOR THE DISCOUNT-------------------------
            Target collection = collection that the discount will be applied to.
            Discount percentage = percentage of the discount that will be applied eligible cart items.
            Cart value threshold = minimum value of the cart for the discount to be applied.
---------------------------------------------------------------------------------
*/
const TARGET_COLLECTION: &str = "gid://shopify/Collection/496241049921";
const DISCOUNT_PERCENTAGE: f64 = 15.0;
const CART_VALUE_THRESHOLD: f64 = 150.0;

// The main function that will be executed by the Shopify
#[shopify_function_target(query_path = "src/run.graphql", schema_path = "schema.graphql")]
fn run(input: input::ResponseData) -> Result<output::FunctionRunResult> {
    // Define the "no discount" outcome.
    let no_discount = output::FunctionRunResult {
        discounts: vec![],
        discount_application_strategy: output::DiscountApplicationStrategy::FIRST,
    };

    // 1. Calculate the total cart value using f64 arithmetic.
    let mut total_cart_value_f64: f64 = 0.0;
    for line in &input.cart.lines {
        // Check that the cost is an amount per quantity.
        let line_amount: f64 = line.cost.amount_per_quantity.amount.0;
        total_cart_value_f64 += line_amount * (line.quantity as f64);
    }
    
    
    // 2. Check if the total cart value is at least 150 EUR.
    if total_cart_value_f64 < CART_VALUE_THRESHOLD {
        eprintln!("Cart value {} is less than 150.", total_cart_value_f64);
        return Ok(no_discount);
    }
    
    // 3. Build discount targets only for cart lines in the specified collection.
    let mut targets = vec![];
    for line in &input.cart.lines {
        if let input::InputCartLinesMerchandise::ProductVariant(variant) = &line.merchandise {
            // Check if the product variant belongs to the target collection.
            if variant.product.in_collections.iter().any(|col| col.collection_id == TARGET_COLLECTION && col.is_member) {
                targets.push(output::Target::CartLine(output::CartLineTarget {
                    id: line.id.to_string(),
                    quantity: None,
                }));
            }
        }
    }
    
    // If no eligible cart lines, then no discount is applied.
    if targets.is_empty() {
        eprintln!("No cart lines belong to the target collection.");
        return Ok(no_discount);
    }

    // 4. Apply a specific discount(15% in this case) to the eligible targets.
    Ok(output::FunctionRunResult {
        discounts: vec![output::Discount {
            message: Some("15% discount applied to eligible collection items.".to_string()),
            targets,
            value: output::Value::Percentage(output::Percentage {
                value: Decimal(DISCOUNT_PERCENTAGE),
            }),
        }],
        discount_application_strategy: output::DiscountApplicationStrategy::FIRST,
    })
}

/*
---------------------------TEST CASES------------------------------------
                To run the test cases, use the following command:
                ------> cargo test -- --nocapture <------
-------------------------------------------------------------------------
*/

#[cfg(test)]
mod tests {
    use super::*;
    use shopify_function::{run_function_with_input, Result};
    use crate::run::run::output;

    // Test 1: Empty cart -> no discount.
    #[test]
    fn test_empty_cart() -> Result<()> {
        let input = r#"
        {
            "cart": {
                "lines": []
            }
        }
        "#;
        let result = run_function_with_input(run, input)?;
        let expected = output::FunctionRunResult {
            discounts: vec![],
            discount_application_strategy: output::DiscountApplicationStrategy::FIRST,
        };
        assert_eq!(result, expected);
        Ok(())
    }

    // Test 2: Cart below threshold -> no discount even if eligible product is present.
    #[test]
    fn test_cart_below_threshold() -> Result<()> {
        let input = r#"
        {
            "cart": {
                "lines": [
                    {
                        "id": "gid://shopify/CartLine/0",
                        "quantity": 1,
                        "cost": {
                            "amountPerQuantity": {
                                "amount": "100.0",
                                "currencyCode": "EUR"
                            }
                        },
                        "merchandise": {
                            "__typename": "ProductVariant",
                            "id": "gid://shopify/ProductVariant/111",
                            "sku": "SKU111",
                            "product": {
                                "inCollections": [
                                    {
                                        "collectionId": "gid://shopify/Collection/496241049921",
                                        "isMember": true
                                    }
                                ]
                            }
                        }
                    }
                ]
            }
        }
        "#;
        // Total value = 100 < 150.
        let result = run_function_with_input(run, input)?;
        let expected = output::FunctionRunResult {
            discounts: vec![],
            discount_application_strategy: output::DiscountApplicationStrategy::FIRST,
        };
        assert_eq!(result, expected);
        Ok(())
    }

    // Test 3: Cart above threshold with an eligible product.
    #[test]
    fn test_cart_with_eligible_product() -> Result<()> {
        let input = r#"
        {            
            "cart": {
                "lines": [
                    {
                        "id": "gid://shopify/CartLine/0",
                        "quantity": 2,
                        "cost": {
                            "amountPerQuantity": {
                                "amount": "100.0",
                                "currencyCode": "EUR"
                            }
                        },
                        "merchandise": {
                            "__typename": "ProductVariant",
                            "id": "gid://shopify/ProductVariant/111",
                            "sku": "SKU111",
                            "product": {
                                "inCollections": [
                                    {
                                        "collectionId": "gid://shopify/Collection/496241049921",
                                        "isMember": true
                                    }
                                ]
                            }
                        }
                    },
                    {
                        "id": "gid://shopify/CartLine/1",
                        "quantity": 1,
                        "cost": {
                            "amountPerQuantity": {
                                "amount": "50.0",
                                "currencyCode": "EUR"
                            }
                        },
                        "merchandise": {
                            "__typename": "ProductVariant",
                            "id": "gid://shopify/ProductVariant/222",
                            "sku": "SKU222",
                            "product": {
                                "inCollections": [
                                    {
                                        "collectionId": "gid://shopify/Collection/NOTELIGIBLE",
                                        "isMember": true
                                    }
                                ]
                            }
                        }
                    }
                ]
            }
        }
        "#;
        // Total cart value = (2 * 100) + (1 * 50) = 250, which exceeds the threshold.
        // Only the first cart line qualifies.
        let result = run_function_with_input(run, input)?;
        let expected = output::FunctionRunResult {
            discounts: vec![output::Discount {
                message: Some("15% discount applied to eligible collection items.".to_string()),
                targets: vec![output::Target::CartLine(output::CartLineTarget {
                    id: "gid://shopify/CartLine/0".to_string(),
                    quantity: None,
                })],
                value: output::Value::Percentage(output::Percentage {
                    value: Decimal(DISCOUNT_PERCENTAGE),
                }),
            }],
            discount_application_strategy: output::DiscountApplicationStrategy::FIRST,
        };
        assert_eq!(result, expected);
        Ok(())
    }

    // Test 4: Cart above threshold but with no eligible products.
    #[test]
    fn test_cart_with_no_eligible_products() -> Result<()> {
        let input = r#"
        {            
            "cart": {
                "lines": [
                    {
                        "id": "gid://shopify/CartLine/0",
                        "quantity": 2,
                        "cost": {
                            "amountPerQuantity": {
                                "amount": "100.0",
                                "currencyCode": "EUR"
                            }
                        },
                        "merchandise": {
                            "__typename": "ProductVariant",
                            "id": "gid://shopify/ProductVariant/111",
                            "sku": "SKU111",
                            "product": {
                                "inCollections": [
                                    {
                                        "collectionId": "gid://shopify/Collection/NOTELIGIBLE",
                                        "isMember": true
                                    }
                                ]
                            }
                        }
                    }
                ]
            }
        }
        "#;
        // Total cart value = 200 (above threshold), but no product is in the target collection.
        let result = run_function_with_input(run, input)?;
        let expected = output::FunctionRunResult {
            discounts: vec![],
            discount_application_strategy: output::DiscountApplicationStrategy::FIRST,
        };
        assert_eq!(result, expected);
        Ok(())
    }
}
