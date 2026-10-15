# 🛰️ Aqua Roof — Geospacial Rain Analytics
**Stop Guessing. Measure Your Roof from Space and Plan Your Rainwater Harvest in 60 Seconds.**

## 📌 Problem Statement
Many households and campuses could save thousands of liters of water and recharge depleted groundwater tables, but they do not know how much rainwater their roof can actually collect. Setup decisions for storage tanks and recharge pits are usually made by guesswork, leading to overflowing pits during heavy monsoons or wasted money on oversized structures.

## 💡 Full-Stack Architecture
Aqua Roof is engineered as a **Full-Stack Web Application** separating backend calculation logic from the geospatial frontend:
* **Backend (`app.py`):** Built with **Python Flask REST API**, handling core Central Ground Water Board (CGWB) water balance math, rainfall processing, and recharge pit sizing rules.
* **Frontend (`index.html`, `style.css`, `script.js`):** Responsive user interface featuring interactive satellite maps, draggable numbered roof corner pins, and live client-side fallbacks.

---

## 🚀 Key Features
1. **Precision Satellite Roof Tracing:** Uses Leaflet.js with Esri and Google Hybrid imagery. Users click 3 or more corners of a roof, and **fully draggable numbered corner handles (1, 2, 3...)** let users reshape the polygon live while the area ($\text{m}^2$ & $\text{sq. ft.}$) updates instantly via the Spherical Shoelace formula.
2. **Multi-Stage GPS & Coordinate Jump:** Supports standard browser GPS, automatic Wi-Fi network fallback, direct Latitude/Longitude coordinate navigation, and address search via OpenStreetMap Nominatim.
3. **CGWB Scientific Water Balance Engine:** Calculates Gross Rainfall and transparently subtracts surface evaporation loss, first-rain dirt flush loss ($1.5\text{ mm}$ per rainy day), and 10% filter efficiency loss.
4. **Smart Groundwater Recharge Sizing:** Sizes recharge pits based on a **$50\text{ mm}$ peak single-day heavy storm event** and local soil percolation rates (Sandy, Loamy, Clay).

---

## 🧮 CGWB Mathematical Formula
Since $1\text{ mm}$ of rainfall on $1\text{ m}^2$ of horizontal roof area equals exactly **1 Liter** of water:

$$\text{Gross Rainwater (L)} = \text{Horizontal Roof Area (m}^2\text{)} \times \text{Annual Rainfall (mm)}$$

$$\text{Net Collectable Water (L)} = \big[(\text{Area} \times \text{Rainfall} \times C) - \text{First-Flush Loss}\big] \times \text{Filter Efficiency}$$

* **Runoff Coefficients ($C$):** Concrete/RCC = `0.70` | Tiled Roof = `0.75` | Metal Sheet = `0.90` | Brick Terrace = `0.60`
* **First-Flush Loss:** $1.5\text{ mm}$ per rainy day diverted to wash dust and debris off the roof.

---

## 🛠️ Technology Stack
* **Backend:** Python 3, Flask REST API (`app.py`), `requirements.txt`
* **Frontend:** HTML5, CSS3 Responsive Grid, Vanilla JavaScript (ES6)
* **Geospatial & Climate APIs:** Leaflet.js, Esri World Imagery HD, Open-Meteo Weather Archive API, GeoJS / IPAPI Network Geolocation

---

## ⚙️ How to Run Locally in PyCharm
1. Open the project folder in **PyCharm**.
2. Open the PyCharm **Terminal** at the bottom and install Flask:
   ```bash
   pip install flask
