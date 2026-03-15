EAFC 26 Footballers Rating Dashboard ⚽📊
Python · D3.js · Exploratory Data Analytics

🧠 Project Overview
The EAFC 26 Footballers Rating Dashboard is an interactive data visualization project that explores performance metrics of 17,000+ football players across top leagues.
It highlights player ratings, growth potential, and market values, providing a self-serve, visual analytics experience for fans, scouts, and analysts.

This project demonstrates end-to-end data handling, from data cleaning and transformation in Python, to building an interactive D3.js dashboard hosted via GitHub Pages.

🚀 Key Features
Exploratory Data Analysis (EDA) on over 17k player records—identifying patterns, trends, and insights across leagues and positions.

Full Data Pipeline: ingestion, cleaning, wrangling, and transformation into a structured format ready for analysis.

D3.js Interactive Dashboard: explore metrics through dynamic charts, hover insights, filters, and comparative views.

Responsive design suitable for both desktop and mobile screens.

Example use cases:

Compare Top 5 league players by rating or potential.

Explore Market Value vs. Age Distribution.

Identify Emerging Talents or Underrated players by position.

🧩 Tech Stack
Category	Technologies
Languages	Python, JavaScript
Libraries/Frameworks	Pandas, NumPy, D3.js
Visualization Tools	D3.js, Matplotlib (EDA)
Deployment	GitHub Pages
Version Control	Git, GitHub
🧹 Data Pipeline
Data Ingestion: Loaded the EAFC player dataset (CSV format).

Cleaning: Handled missing values, standardized naming formats, and normalized numeric columns.

Transformation: Derived key fields — like positional averages, rating deltas, and potential differentials.

Exploration: Generated data summaries and visual insights using Pandas and Matplotlib.

Visualization: Passed processed JSON to D3.js for rendering the interactive dashboard components.

📊 Dashboard Highlights
Ratings Comparison by Position – average player ratings vs. potential growth.

Market Value Distribution – visual breakdown by age groups or leagues.

Top Performers View – spotlight on elite players in each league.

Hover Tooltips and Filters – interactive exploration for deeper analysis.

Explore the live version here:
👉 EAFC 26 Dashboard

📁 Project Structure
text
EAFC26-Footballers-Dashboard/
│
├── data/                  # Raw and cleaned datasets
├── scripts/               # Python cleaning and processing scripts
├── assets/                # Icons, logos, supporting visuals
├── js/                    # D3.js visualization scripts
├── index.html             # Main dashboard page
├── style.css              # Styling and layout
└── README.md              # Project documentation
📦 Setup & Usage
Clone Repository

bash
git clone https://github.com/<your-username>/EAFC26-Footballers-Dashboard.git
Launch Dashboard
Open index.html in your browser or serve via a local HTTP server:

bash
python3 -m http.server
Explore Interactively
Navigate through charts to explore player insights, market trends, and positional distributions.

📈 Insights Example
Here’s a small example insight discovered during analysis:

Players aged 24–27 show the highest ratio of market value to rating across top European leagues, indicating a premium on players nearing peak performance.

📚 Dataset
The dataset is derived from publicly available EAFC 26 player data (analogous to FIFA player stats).
Each record includes:

Player name, nationality, age, and club

Position, overall rating, potential rating

Market value, wage, preferred foot, and work rate

💡 Future Improvements
Incorporate real-time player updates via API integration.

Add machine learning models for player rating prediction.

Introduce league comparison dashboards with advanced filters.

👨‍💻 Author
Jeffrey Hamlin Vinod Auxalia Raja
🎓 MSc Computer Science (Data Science), Trinity College Dublin
💼 Aspiring Software Engineer | Data & AI Enthusiast
🌐 jeffrey-hamlin-v.github.io · LinkedIn

🏆 Acknowledgments
Special thanks to EAFC data contributors and the open-source community supporting D3.js and data visualization projects.

