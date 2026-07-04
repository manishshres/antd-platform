import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ExtractedModifierOption {
  name: string;
  priceAdjustment: number;
}

export interface ExtractedModifierGroup {
  name: string;
  isRequired: boolean;
  options: ExtractedModifierOption[];
}

export interface ExtractedItem {
  name: string;
  description: string;
  price: number; // in cents
  modifiers?: ExtractedModifierGroup[];
}

export interface ExtractedCategory {
  name: string;
  items: ExtractedItem[];
}

export interface ExtractedMenu {
  categories: ExtractedCategory[];
}

@Injectable()
export class AiExtractorService {
  private readonly logger = new Logger(AiExtractorService.name);

  constructor(private readonly configService: ConfigService) {}

  async extract(text: string): Promise<ExtractedMenu> {
    const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');

    if (!apiKey) {
      this.logger.error(
        'DEEPSEEK_API_KEY is not defined. Cannot extract menu.',
      );
      throw new Error('DEEPSEEK_API_KEY is not defined.');
    }

    try {
      this.logger.log(
        'Sending text to DeepSeek API for structured menu extraction...',
      );
      const url = `https://api.deepseek.com/chat/completions`;

      const systemPrompt = `
You are an expert restaurant menu parser.
Analyze the provided raw scraped website text and extract all categories (e.g. Appetizers, Mains, Drinks) and their corresponding menu items.
For each menu item, extract:
- Name (string)
- Description (string, empty if not found)
- Price in cents (integer, e.g. $14.99 becomes 1499. If no price is found, assign a reasonable estimation like 1200 or 1500).
- Modifiers (optional array of modifier groups if options/add-ons/sizes exist for this item)
  - For each modifier group, extract:
    - name (string, e.g. "Size" or "Add-ons")
    - isRequired (boolean)
    - options (array of objects with 'name' and 'priceAdjustment' in cents, where 0 means no extra cost)

Return ONLY a JSON object that strictly adheres to this schema structure. 
WARNING: The following JSON is just an EXAMPLE of the structure. DO NOT output this example data. You MUST extract the actual categories and items from the provided Raw Text.

EXAMPLE FORMAT:
{
  "categories": [
    {
      "name": "Pizza",
      "items": [
        {
          "name": "Classic Margherita",
          "description": "San Marzano tomatoes, fresh mozzarella, basil",
          "price": 1499,
          "modifiers": [
            {
              "name": "Size",
              "isRequired": true,
              "options": [
                { "name": "Medium", "priceAdjustment": 0 },
                { "name": "Large", "priceAdjustment": 300 }
              ]
            }
          ]
        }
      ]
    }
  ]
}

Ensure your response is valid JSON.
      `;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s timeout for DeepSeek

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-v4-pro',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Raw Text:\n${text}` },
          ],
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'No text');
        this.logger.error(
          `DeepSeek API Error: ${response.status} - ${errorText}`,
        );
        throw new Error(
          `DeepSeek API returned status: ${response.status}. Details: ${errorText}`,
        );
      }

      const data = await response.json();
      const rawJson = data.choices?.[0]?.message?.content;

      if (!rawJson) {
        throw new Error('DeepSeek API response does not contain parsed text.');
      }

      let jsonString = rawJson;
      // Strip markdown code blocks just in case
      const jsonMatch = rawJson.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (jsonMatch) {
        jsonString = jsonMatch[0];
      }

      const parsed = JSON.parse(jsonString) as ExtractedMenu;
      if (!parsed.categories || !Array.isArray(parsed.categories)) {
        throw new Error('Invalid JSON structure returned by AI.');
      }

      this.logger.log(
        `AI successfully extracted ${parsed.categories.length} categories.`,
      );
      return parsed;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`AI Extraction failed: ${errMsg}.`);
      throw new Error(`AI Extraction failed: ${errMsg}`);
    }
  }

  private generateMockMenu(text: string): ExtractedMenu {
    const textLower = text.toLowerCase();

    // Check keywords to personalize the mock menu
    if (
      textLower.includes('pizza') ||
      textLower.includes('italian') ||
      textLower.includes('pasta')
    ) {
      return {
        categories: [
          {
            name: 'Pizzas (AI Scraped)',
            items: [
              {
                name: 'Margherita Pizza',
                description:
                  'Fresh tomatoes, mozzarella, and aromatic basil leaves.',
                price: 1399,
                modifiers: [
                  {
                    name: 'Size',
                    isRequired: true,
                    options: [
                      { name: 'Medium 12"', priceAdjustment: 0 },
                      { name: 'Large 16"', priceAdjustment: 400 },
                    ],
                  },
                ],
              },
              {
                name: 'Pepperoni Supreme',
                description:
                  'Loaded with spicy pepperoni slices and mozzarella cheese.',
                price: 1599,
              },
              {
                name: 'Veggie Garden',
                description:
                  'Bell peppers, mushrooms, onions, black olives, and sweetcorn.',
                price: 1449,
              },
            ],
          },
          {
            name: 'Pastas & Sides (AI Scraped)',
            items: [
              {
                name: 'Fettuccine Alfredo',
                description:
                  'Creamy garlic parmesan sauce over fresh fettuccine.',
                price: 1699,
              },
              {
                name: 'Garlic Breadsticks',
                description:
                  'Four baked breadsticks brushed with garlic butter and herbs.',
                price: 599,
              },
            ],
          },
        ],
      };
    }

    if (
      textLower.includes('sushi') ||
      textLower.includes('japanese') ||
      textLower.includes('ramen')
    ) {
      return {
        categories: [
          {
            name: 'Sushi Rolls (AI Scraped)',
            items: [
              {
                name: 'California Roll',
                description: 'Crab meat, avocado, cucumber, and sesame seeds.',
                price: 899,
              },
              {
                name: 'Spicy Tuna Roll',
                description: 'Chopped spicy yellowfin tuna and cucumber.',
                price: 1199,
              },
              {
                name: 'Dragon Roll',
                description:
                  'Eel and cucumber inside, avocado and unagi sauce on top.',
                price: 1599,
              },
            ],
          },
          {
            name: 'Ramen & Hot Dishes (AI Scraped)',
            items: [
              {
                name: 'Tonkotsu Ramen',
                description:
                  'Rich pork broth, chashu pork, soft egg, green onions.',
                price: 1499,
              },
              {
                name: 'Gyoza Dumplings',
                description:
                  'Pan-fried chicken and vegetable dumplings with dipping sauce.',
                price: 799,
              },
            ],
          },
        ],
      };
    }

    if (
      textLower.includes('burger') ||
      textLower.includes('steak') ||
      textLower.includes('grill') ||
      textLower.includes('bbq')
    ) {
      return {
        categories: [
          {
            name: 'Gourmet Burgers (AI Scraped)',
            items: [
              {
                name: 'Classic Cheeseburger',
                description:
                  'Flame-grilled angus beef, cheddar, lettuce, tomato, house sauce.',
                price: 1299,
                modifiers: [
                  {
                    name: 'Add-ons',
                    isRequired: false,
                    options: [
                      { name: 'Bacon', priceAdjustment: 200 },
                      { name: 'Extra Cheese', priceAdjustment: 100 },
                    ],
                  },
                ],
              },
              {
                name: 'Bacon BBQ Smokehouse',
                description:
                  'Smoked bacon, crispy onion rings, cheddar, sweet BBQ glaze.',
                price: 1499,
              },
            ],
          },
          {
            name: 'Steaks & Sides (AI Scraped)',
            items: [
              {
                name: 'New York Strip',
                description:
                  '12oz center-cut strip steak grilled to order, herb butter.',
                price: 2899,
              },
              {
                name: 'Truffle Fries',
                description:
                  'Hand-cut fries tossed with truffle oil and parmesan.',
                price: 699,
              },
            ],
          },
        ],
      };
    }

    // Default Fallback Menu
    return {
      categories: [
        {
          name: 'Popular Dishes (AI Scraped)',
          items: [
            {
              name: 'Crispy Chicken Tenders',
              description:
                'Golden fried chicken strips served with honey mustard.',
              price: 1099,
            },
            {
              name: 'House Caesar Salad',
              description:
                'Romaine lettuce, shaved parmesan, garlic croutons, caesar dressing.',
              price: 999,
            },
            {
              name: 'Classic Pepperoni Pizza',
              description:
                'Rustic thin crust, tomato sauce, pepperoni, mozzarella.',
              price: 1499,
            },
          ],
        },
        {
          name: 'Beverages (AI Scraped)',
          items: [
            {
              name: 'Fresh Lemonade',
              description: 'House-squeezed lemons, pure cane sugar.',
              price: 399,
            },
            {
              name: 'Iced Latte',
              description: 'Double shot espresso, cold milk over ice.',
              price: 499,
            },
          ],
        },
      ],
    };
  }
}
