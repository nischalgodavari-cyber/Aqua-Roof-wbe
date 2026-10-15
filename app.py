from flask import Flask, request, jsonify, send_from_directory
import os

# Lock onto the exact folder ('with backend') where app.py is saved
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder=BASE_DIR, static_url_path='')

# Verified IMD / CGWB City Rainfall Dataset
CITY_DATA = {
    "Tirupati, AP": {"rainfall_mm": 934, "lat": 13.6288, "lng": 79.4192, "rainy_days": 48},
    "Chennai, TN": {"rainfall_mm": 1400, "lat": 13.0827, "lng": 80.2707, "rainy_days": 58},
    "Bengaluru, KA": {"rainfall_mm": 970, "lat": 12.9716, "lng": 77.5946, "rainy_days": 56},
    "Hyderabad, TS": {"rainfall_mm": 812, "lat": 17.3850, "lng": 78.4867, "rainy_days": 46},
    "Visakhapatnam, AP": {"rainfall_mm": 1110, "lat": 17.6868, "lng": 83.2185, "rainy_days": 55},
    "Mumbai, MH": {"rainfall_mm": 2420, "lat": 19.0760, "lng": 72.8777, "rainy_days": 84},
    "New Delhi, DL": {"rainfall_mm": 790, "lat": 28.6139, "lng": 77.2090, "rainy_days": 38},
    "Pune, MH": {"rainfall_mm": 750, "lat": 18.5204, "lng": 73.8567, "rainy_days": 50},
    "Kolkata, WB": {"rainfall_mm": 1640, "lat": 22.5726, "lng": 88.3639, "rainy_days": 78},
    "Kochi, KL": {"rainfall_mm": 3015, "lat": 9.9312, "lng": 76.2673, "rainy_days": 115},
    "Jaipur, RJ": {"rainfall_mm": 560, "lat": 26.9124, "lng": 75.7873, "rainy_days": 30},
}

MONTHLY_WEIGHTS = [0.01, 0.01, 0.02, 0.03, 0.06, 0.14, 0.20, 0.19, 0.15, 0.11, 0.06, 0.02]


@app.route("/")
def serve_index():
    """Serves index.html (or indexx.html if not renamed yet) from the 'with backend' folder."""
    if os.path.exists(os.path.join(BASE_DIR, "index.html")):
        return send_from_directory(BASE_DIR, "index.html")
    elif os.path.exists(os.path.join(BASE_DIR, "indexx.html")):
        return send_from_directory(BASE_DIR, "indexx.html")
    return f"<h3>Error: Put index.html inside {BASE_DIR}</h3>", 404


@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({"status": "ok", "engine": "Python Flask CGWB Water Balance API"})


@app.route("/api/cities", methods=["GET"])
def get_cities():
    return jsonify(CITY_DATA)


@app.route("/api/calculate", methods=["POST"])
def calculate_rainwater_harvest():
    data = request.get_json(silent=True) or {}

    raw_area = float(data.get("rawArea", 139))
    unit = data.get("unit", "sqm")
    runoff_coeff = float(data.get("runoffCoeff", 0.70))
    annual_rainfall_mm = float(data.get("annualRainfallMm", 934))
    filter_eff_percent = float(data.get("filterEffPercent", 90))
    occupants = max(1, int(data.get("occupants", 5)))
    tanker_price = float(data.get("tankerPrice", 900))
    soil_type = data.get("soilType", "loamy")
    rainy_days = max(1, int(data.get("rainyDays", 48)))

    area_sqm = raw_area / 10.7639 if unit == "sqft" else raw_area
    area_sqft = raw_area if unit == "sqft" else raw_area * 10.7639

    gross_litres = area_sqm * annual_rainfall_mm
    runoff_after_surface = gross_litres * runoff_coeff
    surface_loss = gross_litres - runoff_after_surface

    first_flush_depth_mm = min(annual_rainfall_mm * 0.08, rainy_days * 1.5)
    first_flush_loss = area_sqm * first_flush_depth_mm * runoff_coeff

    water_entering_filter = max(0.0, runoff_after_surface - first_flush_loss)
    net_collectable_litres = water_entering_filter * (filter_eff_percent / 100.0)
    filter_loss = water_entering_filter - net_collectable_litres

    tankers_saved = net_collectable_litres / 5000.0
    annual_rupees_saved = round(tankers_saved * tanker_price)
    daily_non_potable_demand = occupants * 80
    days_supported = round(net_collectable_litres / daily_non_potable_demand)

    peak_storm_litres = area_sqm * 50.0 * runoff_coeff * (filter_eff_percent / 100.0)

    soil_factor = 0.85 if soil_type == "sandy" else (1.0 if soil_type == "loamy" else 1.25)
    required_pit_volume_m3 = max(2.5, (peak_storm_litres / 1000.0) * 0.55 * soil_factor)

    if area_sqm <= 120:
        category_badge = "Small Home Recharge Pit"
        structure_title = "1. Pit Size to Dig (Small Home Pit)"
        depth_m = round(min(2.4, max(1.8, required_pit_volume_m3 / (1.2 * 1.2))), 1)
        depth_ft = round(depth_m * 3.28084, 1)
        vol_litres = round(1.2 * 1.2 * depth_m * 1000)
        dimensions_text = f"Dig a pit 1.2 m Long × 1.2 m Wide × {depth_m} m Deep (approx. 4 ft × 4 ft × {depth_ft} ft)."
        capacity_badge = f"Pit Volume: ~{vol_litres:,} Liters"
        pipe_specs = "Connect your roof drainpipe (3-inch or 4-inch PVC) through a simple leaf-mesh strainer into the pit. Optional: Keep a 1,500 L drum for garden water."
        min_cost, max_cost = 14000, 19000
    elif area_sqm <= 300:
        category_badge = "Medium Home Recharge Pit"
        structure_title = "1. Pit Size to Dig (Standard Home Pit)"
        depth_m = round(min(3.0, max(2.0, required_pit_volume_m3 / (1.5 * 1.5))), 1)
        depth_ft = round(depth_m * 3.28084, 1)
        vol_litres = round(1.5 * 1.5 * depth_m * 1000)
        dimensions_text = f"Dig a pit 1.5 m Long × 1.5 m Wide × {depth_m} m Deep (approx. 5 ft × 5 ft × {depth_ft} ft)."
        capacity_badge = f"Pit Volume: ~{vol_litres:,} Liters"
        pipe_specs = "Connect your roof drainpipe (4-inch PVC) through a leaf-mesh filter straight into the top of the pit. Optional: Add a 3,000 L tank for cleaning/flushing."
        min_cost, max_cost = 18000, 26000
    else:
        category_badge = "Large Building / Campus Trench"
        structure_title = "1. Trench Size to Dig (Apartment / Campus)"
        length_m = round(min(10.0, max(3.5, required_pit_volume_m3 / (1.5 * 2.0))), 1)
        length_ft = round(length_m * 3.28084)
        vol_litres = round(length_m * 1.5 * 2.0 * 1000)
        dimensions_text = f"Dig a rectangular trench {length_m} m Long × 1.5 m Wide × 2.0 m Deep (approx. {length_ft} ft × 5 ft × 6.5 ft)."
        capacity_badge = f"Trench Volume: ~{vol_litres:,} Liters"
        pipe_specs = "Connect building roof pipes (6-inch PVC) through a settling chamber into the recharge trench. Recommended: 10,000 L storage sump."
        min_cost, max_cost = 42000, 65000

    avg_cost = (min_cost + max_cost) / 2.0
    payback_years = round(avg_cost / annual_rupees_saved, 1) if annual_rupees_saved > 0 else 0
    monthly_distribution = [round(net_collectable_litres * w) for w in MONTHLY_WEIGHTS]

    return jsonify({
        "areaSqM": round(area_sqm),
        "areaSqFt": round(area_sqft),
        "grossLitres": round(gross_litres),
        "surfaceLoss": round(surface_loss),
        "firstFlushLoss": round(first_flush_loss),
        "filterLoss": round(filter_loss),
        "netCollectableLitres": round(net_collectable_litres),
        "netCubicMeters": round(net_collectable_litres / 1000.0, 1),
        "tankersSaved": round(tankers_saved, 1),
        "annualRupeesSaved": annual_rupees_saved,
        "dailyNonPotableDemand": daily_non_potable_demand,
        "daysSupported": days_supported,
        "peakStormLitres": round(peak_storm_litres),
        "monthlyValues": monthly_distribution,
        "recharge": {
            "categoryBadge": category_badge,
            "structureTitle": structure_title,
            "dimensionsText": dimensions_text,
            "capacityBadge": capacity_badge,
            "pipeSpecs": pipe_specs,
            "minCost": min_cost,
            "maxCost": max_cost,
            "paybackYears": payback_years
        }
    })


if __name__ == "__main__":
    print("==========================================================")
    print(" 🛰️ Aqua Roof Python Backend Server Running!")
    print(" 👉 Open this link in Chrome: http://127.0.0.1:5000")
    print("==========================================================")
    app.run(host="127.0.0.1", port=5000, debug=True)