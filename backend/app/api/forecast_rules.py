from fastapi import APIRouter
from pydantic import BaseModel

from app.services.horizon import MAX_HORIZON, MIN_HORIZON

router = APIRouter()


class HorizonRule(BaseModel):
    min_hours: float
    max_hours: float
    inclusive: bool


@router.get("/forecast-rules/horizon")
def horizon_rule() -> HorizonRule:
    # The dashboard reads the bounds from here so the rule is defined in one place.
    return HorizonRule(
        min_hours=MIN_HORIZON.total_seconds() / 3600,
        max_hours=MAX_HORIZON.total_seconds() / 3600,
        inclusive=True,
    )
