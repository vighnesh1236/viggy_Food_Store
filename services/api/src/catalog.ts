export type FoodCategory =
  | "Biryani"
  | "North Indian"
  | "South Indian"
  | "Cake"
  | "Dosa"
  | "Idli"
  | "Rolls"
  | "Noodles"
  | "Salad"
  | "Shawarma"
  | "Tea"
  | "Starters"
  | "Meals & Thalis"
  | "Curries"
  | "Street Food"
  | "Breads & Rice"
  | "Desserts"
  | "Breakfast"
  | "Drinks"
  | "Combos";

const dishes: Array<{ name: string; category: FoodCategory }> = [
  ...[
    "Paneer Tikka", "Chicken 65", "Chicken Tikka", "Tandoori Chicken",
    "Hara Bhara Kebab", "Crispy Corn", "Gobi Manchurian", "Chilli Paneer",
    "Seekh Kebab", "Fish Amritsari", "Mutton Seekh Kebab", "Veg Spring Rolls",
    "Apollo Fish", "Chicken Lollipop", "Mushroom Pepper Fry", "Prawn Koliwada",
    "Samosa (2 pcs)", "Dahi Ke Kebab", "Andhra Chicken Fry", "Masala Papad",
  ].map((name) => ({ name, category: "Starters" as const })),
  ...[
    "Hyderabadi Chicken Dum Biryani", "Hyderabadi Mutton Dum Biryani", "Lucknowi Chicken Biryani",
    "Kolkata Chicken Biryani", "Kolkata Aloo Biryani", "Ambur Chicken Biryani",
    "Thalassery Chicken Biryani", "Veg Dum Biryani", "Paneer Biryani", "Egg Biryani",
    "Chicken 65 Biryani", "Mutton Keema Biryani", "Prawn Biryani", "Kacchi Mutton Biryani",
    "Jackfruit Biryani",
  ].map((name) => ({ name, category: "Biryani" as const })),
  ...[
    "Amritsari Chole Kulche", "Paneer Tikka Masala", "Punjabi Kadhi Pakora",
    "Kashmiri Dum Aloo", "Litti Chokha", "Bedmi Puri Aloo",
  ].map((name) => ({ name, category: "North Indian" as const })),
  ...[
    "Chettinad Mushroom Masala", "Kerala Appam with Stew", "Mangalorean Neer Dosa",
    "Andhra Gongura Chicken", "Karnataka Bisi Bele Bath", "Tamil Nadu Lemon Rice",
  ].map((name) => ({ name, category: "South Indian" as const })),
  ...[
    "North Indian Veg Thali", "Punjabi Deluxe Thali", "South Indian Meals",
    "Andhra Meals with Pappu", "Rajasthani Dal Baati Thali", "Gujarati Unlimited Thali",
    "Kerala Sadya Meal", "Bengali Fish Thali", "Chicken Curry Meal", "Mutton Curry Meal",
    "Paneer Butter Masala Meal", "Rajma Chawal Bowl", "Chole Chawal Bowl",
    "Millet Veg Meal Bowl", "Mini Office Lunch Thali",
  ].map((name) => ({ name, category: "Meals & Thalis" as const })),
  ...[
    "Butter Chicken", "Chicken Chettinad", "Mutton Rogan Josh", "Kadai Paneer",
    "Paneer Butter Masala", "Palak Paneer", "Dal Makhani", "Chana Masala",
    "Goan Prawn Curry", "Kerala Fish Curry",
  ].map((name) => ({ name, category: "Curries" as const })),
  ...[
    "Mumbai Vada Pav", "Pav Bhaji", "Pani Puri (6 pcs)", "Dahi Puri",
    "Aloo Tikki Chaat", "Delhi Chole Bhature", "Kathi Chicken Roll",
    "Paneer Frankie", "Masala Dosa", "Mysore Masala Dosa",
  ].map((name) => ({ name, category: "Street Food" as const })),
  ...[
    "Masala Dosa with Sambar", "Rava Dosa", "Onion Uttapam", "Set Dosa (3 pcs)",
  ].map((name) => ({ name, category: "Dosa" as const })),
  ...[
    "Thatte Idli (2 pcs)", "Kanchipuram Idli", "Ghee Podi Idli",
  ].map((name) => ({ name, category: "Idli" as const })),
  ...[
    "Chicken Kathi Roll", "Paneer Tikka Roll", "Egg Frankie Roll", "Schezwan Veg Roll",
  ].map((name) => ({ name, category: "Rolls" as const })),
  ...[
    "Schezwan Hakka Noodles", "Veg Chow Mein", "Chicken Hakka Noodles", "Singapore Noodles",
  ].map((name) => ({ name, category: "Noodles" as const })),
  ...[
    "Indian Sprout Salad", "Kachumber Salad", "Paneer Tikka Salad", "Millet Power Salad",
  ].map((name) => ({ name, category: "Salad" as const })),
  ...[
    "Chicken Shawarma Roll", "Paneer Shawarma Roll", "Classic Chicken Shawarma Plate",
  ].map((name) => ({ name, category: "Shawarma" as const })),
  ...[
    "Adrak Masala Chai", "Elaichi Chai", "Cutting Chai", "Kashmiri Kahwa",
  ].map((name) => ({ name, category: "Tea" as const })),
  ...[
    "Butter Naan", "Garlic Naan", "Tandoori Roti", "Lachha Paratha",
    "Malabar Parotta (2 pcs)", "Jeera Rice",
  ].map((name) => ({ name, category: "Breads & Rice" as const })),
  ...[
    "Gulab Jamun (2 pcs)", "Rasmalai (2 pcs)", "Gajar Ka Halwa",
    "Kesar Kulfi", "Jalebi Rabri", "Mysore Pak", "Kaju Katli",
    "Shahi Tukda", "Phirni", "Rasgulla (2 pcs)", "Moong Dal Halwa",
    "Tender Coconut Payasam",
  ].map((name) => ({ name, category: "Desserts" as const })),
  ...[
    "Chocolate Truffle Cake Slice", "Black Forest Cake Slice", "Rasmalai Cake Slice",
    "Eggless Pineapple Cake Slice",
  ].map((name) => ({ name, category: "Cake" as const })),
  ...[
    "Idli Sambar (3 pcs)", "Medu Vada (2 pcs)", "Pesarattu Upma",
    "Poha with Sev", "Pongal with Chutney",
  ].map((name) => ({ name, category: "Breakfast" as const })),
  ...[
    "Mango Lassi", "Masala Chai", "Filter Coffee", "Fresh Lime Soda",
    "Rose Falooda",
  ].map((name) => ({ name, category: "Drinks" as const })),
  ...[
    "Veg Biryani Family Combo", "Chicken Biryani Feast for Two",
  ].map((name) => ({ name, category: "Combos" as const })),
];

const categoryFoodPhotos: Record<FoodCategory, string[]> = {
  "Biryani": [
    "photo-1691171047312-d809eccef46d",
    "photo-1630409346824-4f0e7b080087",
  ],
  "North Indian": [
    "photo-1603894584373-5ac82b2ae398",
    "photo-1585937421612-70a008356fbe",
    "photo-1631452180519-c014fe946bc7",
  ],
  "South Indian": [
    "photo-1567337710282-00832b415979",
    "photo-1589301760014-d929f3979dbc",
    "photo-1668236543090-82eba5ee5976",
  ],
  "Cake": [
    "photo-1578985545062-69928b1d9587",
    "photo-1565958011703-44f9829ba187",
    "photo-1606890737304-57a1ca8a5b62",
  ],
  "Dosa": [
    "photo-1668236543090-82eba5ee5976",
    "photo-1567337710282-00832b415979",
    "photo-1589301760014-d929f3979dbc",
  ],
  "Idli": [
    "photo-1589301760014-d929f3979dbc",
    "photo-1668236543090-82eba5ee5976",
    "photo-1567337710282-00832b415979",
  ],
  "Rolls": [
    "photo-1626700051175-6818013e1d4f",
    "photo-1529006557810-274b9b2fc783",
    "photo-1482049016688-2d3e1b311543",
  ],
  "Noodles": [
    "photo-1569718212165-3a8278d5f624",
    "photo-1555126634-323283e090fa",
    "photo-1551183053-bf91a1d81141",
    "photo-1552611052-33e04de081de",
  ],
  "Salad": [
    "photo-1512621776951-a57141f2eefd",
    "photo-1547592180-85f173990554",
    "photo-1540189549336-e6e99c3679fe",
  ],
  "Shawarma": [
    "photo-1529006557810-274b9b2fc783",
    "photo-1626700051175-6818013e1d4f",
    "photo-1528735602780-2552fd46c7af",
  ],
  "Tea": [
    "photo-1576092768241-dec231879fc3",
    "photo-1544787219-7f47ccb76574",
    "photo-1556679343-c7306c1976bc",
  ],
  "Starters": [
    "photo-1601050690597-df0568f70950",
    "photo-1631452180519-c014fe946bc7",
    "photo-1567337710282-00832b415979",
    "photo-1565557623262-b51c2513a641",
  ],
  "Meals & Thalis": [
    "photo-1546833999-b9f581a1996d",
    "photo-1625398407796-82650a8c135f",
    "photo-1567337710282-00832b415979",
    "photo-1565557623262-b51c2513a641",
  ],
  "Curries": [
    "photo-1565557623262-b51c2513a641",
    "photo-1585937421612-70a008356fbe",
    "photo-1603894584373-5ac82b2ae398",
    "photo-1631452180519-c014fe946bc7",
  ],
  "Street Food": [
    "photo-1528735602780-2552fd46c7af",
    "photo-1601050690597-df0568f70950",
    "photo-1668236543090-82eba5ee5976",
    "photo-1529006557810-274b9b2fc783",
  ],
  "Breads & Rice": [
    "photo-1549931319-a545dcf3bc73",
    "photo-1586444248902-2f64eddc13df",
    "photo-1546833999-b9f581a1996d",
    "photo-1567337710282-00832b415979",
  ],
  "Desserts": [
    "photo-1488477181946-6428a0291777",
    "photo-1551024506-0bccd828d307",
    "photo-1563805042-7684c019e1cb",
    "photo-1606890737304-57a1ca8a5b62",
  ],
  "Breakfast": [
    "photo-1490645935967-10de6ba17061",
    "photo-1668236543090-82eba5ee5976",
    "photo-1589301760014-d929f3979dbc",
  ],
  "Drinks": [
    "photo-1572490122747-3968b75cc699",
    "photo-1544145945-f90425340c7e",
    "photo-1576092768241-dec231879fc3",
  ],
  "Combos": [
    "photo-1596797038530-2c107229654b",
    "photo-1610192244261-3f33de3f55e4",
    "photo-1567337710282-00832b415979",
  ],
};

function foodImageUrl(photo: string) {
  return `https://images.unsplash.com/${photo}?auto=format&fit=crop&w=700&q=80`;
}

export interface FoodItem {
  id: string;
  name: string;
  category: FoodCategory;
  description: string;
  price: number;
  rating: number;
  imageUrl: string;
  preparationMinutes: number;
}

export const foodCatalog: FoodItem[] = dishes.map((dish, index) => {
  const price = Math.round((100 + ((index * 173 + 97) % 1901)) / 10) * 10;
  const photos = categoryFoodPhotos[dish.category];
  const itemIndex = dishes.slice(0, index).filter((item) => item.category === dish.category).length;
  const isVegetarianBiryani = dish.category === "Biryani" && /veg|aloo|paneer|jackfruit/i.test(dish.name);
  const photo = dish.category === "Biryani"
    ? photos[isVegetarianBiryani ? 1 : 0]
    : photos[itemIndex % photos.length];
  return {
    id: `bb-${String(index + 1).padStart(3, "0")}`,
    name: dish.name,
    category: dish.category,
    description: `Freshly prepared ${dish.name.toLowerCase()} with authentic Indian spices.`,
    price: Math.min(price, 2000),
    rating: Number((4 + ((index * 7) % 10) / 10).toFixed(1)),
    imageUrl: foodImageUrl(photo),
    preparationMinutes: 15 + ((index * 7) % 26),
  };
});

const categoryOrder: FoodCategory[] = [
  "Biryani", "North Indian", "South Indian", "Cake", "Desserts", "Dosa", "Idli", "Rolls",
  "Noodles", "Salad", "Shawarma", "Tea", "Starters", "Meals & Thalis", "Curries",
  "Street Food", "Breads & Rice", "Breakfast", "Drinks", "Combos",
];

export const foodCategories = categoryOrder.filter((category) =>
  foodCatalog.some((food) => food.category === category));

export const foodCategoryImages = Object.fromEntries(
  foodCategories.map((category) => [category, foodImageUrl(categoryFoodPhotos[category][0])]),
) as Record<FoodCategory, string>;
