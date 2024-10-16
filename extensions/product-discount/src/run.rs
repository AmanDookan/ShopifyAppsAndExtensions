use shopify_function::prelude::*;
use shopify_function::Result;
use serde::{Deserialize, Serialize};
use serde::ser::Serializer; 
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all(deserialize = "camelCase"))]
struct Configuration {
    collection_ids: Vec<String>,
    mapping: Vec<CollectionMapping>,
}

#[derive(Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all(deserialize = "camelCase"))]
struct CollectionMapping {
    collection: String,
    threshold: f64,
}

impl Configuration {
    fn from_str(value: &str) -> Self {
        serde_json::from_str(value).expect("Unable to parse configuration value from metafield")
    }
}

#[derive(Serialize, Deserialize, Default, PartialEq)]
struct DiscountData {
    #[serde(rename = "collectionDiscounts")] // Correctly name the field to match the input JSON
    collection_discounts: Vec<CollectionDiscount>,
}

#[derive(Serialize, Deserialize, Default, PartialEq)]
struct CollectionDiscount {
    #[serde(rename = "collection_id")] // Rename to match the input JSON
    collection_id: String,
    discount: f64,
}

// Custom serialization for Decimal
fn serialize_decimal<S>(decimal: &Decimal, serializer: S) -> std::result::Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_f64(decimal.0) // Ensure this serializes as a float
}

#[derive(Serialize, Deserialize, PartialEq)]
struct Percentage {
    #[serde(serialize_with = "serialize_decimal")]
    value: Decimal,
}

#[shopify_function_target(query_path = "src/run.graphql", schema_path = "schema.graphql")]
fn run(input: input::ResponseData) -> Result<output::FunctionRunResult> {
    let mut discounts: Vec<output::Discount> = vec![];
    let no_discount = output::FunctionRunResult {
        discounts: vec![],
        discount_application_strategy: output::DiscountApplicationStrategy::FIRST,
    };

    // Parse the configuration from discountNode metafield
    let config = match input.discount_node.metafield {
        Some(input::InputDiscountNodeMetafield { value }) => Configuration::from_str(&value),
        None => return Ok(no_discount),
    };

    // 1. Calculate total cart value excluding products in the defined collections
    let mut total_cart_value_excluding_collections = Decimal(0.0);

    for line in input.cart.lines.iter() {
        // Directly match on InputCartLinesMerchandise
        let variant = match &line.merchandise {
            input::InputCartLinesMerchandise::ProductVariant(variant) => variant,
            _ => continue,
        };

        // Access the product directly
        let product = &variant.product;

        let is_in_excluded_collection = product
            .in_collections
            .iter()
            .any(|c| c.is_member && config.collection_ids.contains(&c.collection_id));

        if is_in_excluded_collection {
            continue; // Skip excluded products
        } else {
            // Access the price correctly from the line's cost
            let price: f64 = line.cost.amount_per_quantity.amount.0; // Accessing inner f64 value

            // Use Decimal's inner value for multiplication
            let line_value = Decimal(price * (line.quantity as f64)); // Multiply price by quantity
            total_cart_value_excluding_collections = Decimal(total_cart_value_excluding_collections.0 + line_value.0);
        }
    }

    // 2. Find the corresponding threshold for the cart value
    let mut matching_threshold: Option<&CollectionMapping> = None;

    for mapping in config.mapping.iter() {
        // Update only if the cart value is greater than or equal to the threshold
        // and the threshold is higher than the current matching threshold
        if total_cart_value_excluding_collections.0 >= mapping.threshold {
            match matching_threshold {
                Some(threshold) if mapping.threshold > threshold.threshold => {
                    matching_threshold = Some(mapping);
                }
                None => {
                    matching_threshold = Some(mapping);
                }
                _ => {}
            }
        }
    }

    // If no threshold matched, return no discounts
    let matching_threshold = match matching_threshold {
        Some(threshold) => threshold,
        None => return Ok(no_discount),
    };

    // 3. Apply the highest discount to eligible products
    let mut highest_discount = 0.0;
    let mut best_discount: Option<output::Discount> = None;

    // 1. Iterate over the cart lines and find products in the excluded collection
    for line in input.cart.lines.iter() {
        let variant = match &line.merchandise {
            input::InputCartLinesMerchandise::ProductVariant(variant) => variant,
            _ => continue,
        };

        let product = &variant.product;

        // Here, we ignore the is_member logic
        let is_in_excluded_collection = product.in_collections.iter().any(|collection| {
            collection.collection_id == matching_threshold.collection
        });

        if !is_in_excluded_collection {
            continue; // Skip this product if it is not in the excluded collection
        }

        // 3. Get the metafield and parse it
        if let Some(metafield) = &product.metafield {
            let discount_data: DiscountData = serde_json::from_str(&metafield.value)
                .expect("Invalid discount metafield format");

            // 4. Find the discount for the matching collection
            if let Some(discount_entry) = discount_data.collection_discounts.iter().find(|entry| {
                entry.collection_id == matching_threshold.collection
            }) {
                // 5. Track the highest discount
                if discount_entry.discount > highest_discount {
                    highest_discount = discount_entry.discount;

                    // Store the best discount to apply
                    best_discount = Some(output::Discount {
                        message: Some(format!("{}% off", discount_entry.discount)),
                        targets: vec![output::Target::ProductVariant(output::ProductVariantTarget {
                            id: variant.id.clone(),
                            quantity: Some(line.quantity as i64),
                        })],
                        value: output::Value::Percentage(output::Percentage {
                            value: Decimal(discount_entry.discount),
                        }),
                    });
                }
            }
        }
    }

    // 6. Apply the highest discount, if any
    if let Some(discount) = best_discount {
        discounts.push(discount);
    }

    Ok(output::FunctionRunResult {
        discounts,
        discount_application_strategy: output::DiscountApplicationStrategy::FIRST,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use shopify_function::{run_function_with_input, Result};

    #[test]
    fn test_empty_cart_no_discounts() -> Result<()> {
        let result = run_function_with_input(
            run,
            r#"
                {
                    "discountNode": {
                        "metafield": {
                            "value": "{\"collection_ids\":[], \"mapping\":[]}"
                        }
                    },
                    "cart": {
                        "lines": []
                    }
                }
            "#,
        )?;

        let expected = output::FunctionRunResult {
            discounts: vec![],
            discount_application_strategy: output::DiscountApplicationStrategy::FIRST,
        };

        assert_eq!(result, expected);
        Ok(())
    }

    #[test]
    fn test_cart_with_valid_products_applies_discount() -> Result<()> {
        let result = run_function_with_input(
            run,
            r#"
                {
                    "discountNode": {
                        "metafield": {
                            "value": "{\"collection_ids\":[], \"mapping\":[{\"collection\":\"gid://shopify/Collection/1234\", \"threshold\": 300}]}"
                        }
                    },
                    "cart": {
                        "lines": [
                            {
                                "quantity": 1,
                                "cost": {
                                    "amountPerQuantity": {
                                        "amount": 358.00
                                    }
                                },
                                "merchandise": {
                                    "__typename": "ProductVariant",
                                    "id": "gid://shopify/ProductVariant/9876",
                                    "product": {
                                        "inCollections": [],
                                        "metafield": {
                                            "value": "{\"collectionDiscounts\": [{\"collection_id\": \"gid://shopify/Collection/1234\", \"discount\": 10}]}"
                                        }
                                    }
                                }
                            }
                        ]
                    }
                }
            "#,
        )?;

        let expected = output::FunctionRunResult {
            discounts: vec![output::Discount {
                message: Some("10% off".to_string()),
                targets: vec![output::Target::ProductVariant(output::ProductVariantTarget {
                    id: "gid://shopify/ProductVariant/9876".to_string(),
                    quantity: Some(1),
                })],
                value: output::Value::Percentage(output::Percentage {
                    value: Decimal(10.0),
                }),
            }],
            discount_application_strategy: output::DiscountApplicationStrategy::FIRST,
        };

        assert_eq!(result, expected);
        Ok(())
    }

    #[test]
    fn test_cart_with_excluded_products_no_discount() -> Result<()> {
        let result = run_function_with_input(
            run,
            r#"
                {
                    "discountNode": {
                        "metafield": {
                            "value": "{\"collection_ids\":[\"gid://shopify/Collection/987\"], \"mapping\":[{\"collection\":\"gid://shopify/Collection/1234\", \"threshold\": 300}]}"
                        }
                    },
                    "cart": {
                        "lines": [
                            {
                                "quantity": 1,
                                "cost": {
                                    "amountPerQuantity": {
                                        "amount": 358.00
                                    }
                                },
                                "merchandise": {
                                    "__typename": "ProductVariant",
                                    "id": "gid://shopify/ProductVariant/9876",
                                    "product": {
                                        "inCollections": [
                                            {
                                                "isMember": true,
                                                "collectionId": "gid://shopify/Collection/987"
                                            }
                                        ],
                                        "metafield": {
                                            "value": "{\"collectionDiscounts\": [{\"collection_id\": \"gid://shopify/Collection/1234\", \"discount\": 10}]}"
                                        }
                                    }
                                }
                            }
                        ]
                    }
                }
            "#,
        )?;

        let expected = output::FunctionRunResult {
            discounts: vec![],
            discount_application_strategy: output::DiscountApplicationStrategy::FIRST,
        };

        assert_eq!(result, expected);
        Ok(())
    }
}
