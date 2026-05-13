"""SKU catalog and customer segments for a disposable-products distributor."""

from dataclasses import dataclass
from typing import Literal

Segment = Literal["food_service", "healthcare"]


@dataclass(frozen=True)
class SKU:
    sku_id: str
    product_family: str
    name: str
    primary_segment: Segment
    unit_cost: float
    case_pack: int
    lead_time_days: int
    seasonality_pattern: Literal["food_service", "healthcare", "flat"]
    # Relative demand scale: 1.0 == typical SKU; higher = more popular
    demand_scale: float = 1.0


CATALOG: list[SKU] = [
    # Gloves (mixed segment, healthcare-leaning seasonality during winter/flu)
    SKU("GLV-NIT-M", "gloves", "Nitrile Glove M (case 1000)", "healthcare", 32.50, 1000, 7, "healthcare", 1.4),
    SKU("GLV-NIT-L", "gloves", "Nitrile Glove L (case 1000)", "healthcare", 32.50, 1000, 7, "healthcare", 1.2),
    SKU("GLV-VIN-M", "gloves", "Vinyl Glove M (case 1000)", "food_service", 21.00, 1000, 10, "food_service", 1.6),
    SKU("GLV-POL-L", "gloves", "Poly Glove L (case 10000)", "food_service", 8.40, 10000, 14, "food_service", 1.0),
    # Food wraps and films (heavy food_service)
    SKU("WRP-FOIL-18", "wraps", "Foil Roll 18in x 500ft", "food_service", 18.20, 6, 14, "food_service", 0.9),
    SKU("WRP-PLAS-12", "wraps", "Plastic Wrap 12in x 2000ft", "food_service", 12.95, 6, 14, "food_service", 0.8),
    # Containers
    SKU("CTR-8OZ", "containers", "8oz Soup Container", "food_service", 28.00, 500, 14, "food_service", 1.1),
    SKU("CTR-32OZ", "containers", "32oz Bowl with Lid", "food_service", 64.00, 250, 14, "food_service", 0.7),
    # Cutlery
    SKU("CUT-FRK", "cutlery", "Fork (case 1000)", "food_service", 14.50, 1000, 21, "food_service", 1.3),
    SKU("CUT-KIT", "cutlery", "Cutlery Kit (case 250)", "food_service", 32.75, 250, 21, "food_service", 0.6),
    # Portion cups and lids
    SKU("PRT-2OZ", "portion", "2oz Portion Cup (case 2500)", "food_service", 22.00, 2500, 14, "food_service", 1.0),
    # Healthcare exam supplies
    SKU("MED-GAU-4", "medical", "Gauze Pad 4x4 (case 200)", "healthcare", 18.50, 200, 10, "healthcare", 0.5),
]


SKU_INDEX = {sku.sku_id: sku for sku in CATALOG}


def all_skus() -> list[SKU]:
    return list(CATALOG)


def get_sku(sku_id: str) -> SKU:
    return SKU_INDEX[sku_id]
