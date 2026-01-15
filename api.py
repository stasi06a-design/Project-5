from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
from pathlib import Path
from datetime import datetime
from fastapi.responses import RedirectResponse

app = FastAPI(title="Robot Dashboard API")

# Enable CORS for frontend access
app = FastAPI()

# Add this CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_FILE = Path("data/robot_status.json")


class Position(BaseModel):
    x: float
    y: float


class RobotStatus(BaseModel):
    robot_id: str
    timestamp: datetime
    position: Position
    temperature: float
    battery_percentage: int
    rotation: float


def read_robot_data() -> dict:
    """Read the latest robot data from JSON file."""
    if not DATA_FILE.exists():
        raise HTTPException(status_code=404, detail="Robot data not found")
    
    with open(DATA_FILE) as f:
        return json.load(f)

@app.get("/")
def root():
    return RedirectResponse(url="/status")

@app.get("/status", response_model=RobotStatus)
def get_full_status():
    """Get complete robot status."""
    return read_robot_data()


@app.get("/position")
def get_position():
    """Get robot's current position."""
    data = read_robot_data()
    return {"x": data["position"]["x"], "y": data["position"]["y"]}


@app.get("/battery")
def get_battery():
    """Get battery percentage."""
    data = read_robot_data()
    return {"battery_percentage": data["battery_percentage"]}


@app.get("/temperature")
def get_temperature():
    """Get robot temperature."""
    data = read_robot_data()
    return {"temperature": data["temperature"]}


@app.get("/rotation")
def get_rotation():
    """Get robot rotation angle."""
    data = read_robot_data()
    return {"rotation": data["rotation"]}