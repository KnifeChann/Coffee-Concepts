// Common Utility: Format Time (HH:MM:SS or MM:SS)
function formatTime(seconds, showHours = true) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const sec = seconds % 60;
    return showHours
        ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
        : `${String(minutes).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// Main Timer Logic
let mainTimerInterval;
let mainTime = 0;

function startMainTimerFromInput() {
    const userTime = document.getElementById('user-time')?.value;
    if (!userTime) return;

    const timeParts = userTime.split(':');
    if (timeParts.length === 3) {
        const [hrs, mins, secs] = timeParts.map((part) => parseInt(part) || 0);
        mainTime = hrs * 3600 + mins * 60 + secs;
        document.getElementById('main-timer').innerText = formatTime(mainTime);

        if (mainTime > 0 && !mainTimerInterval) {
            mainTimerInterval = setInterval(() => {
                if (mainTime > 0) {
                    mainTime--;
                    document.getElementById('main-timer').innerText = formatTime(mainTime);
                } else {
                    stopMainTimer();
                    alert("Main Timer Finished!");
                }
            }, 1000);
        }
    }
}

function stopMainTimer() {
    clearInterval(mainTimerInterval);
    mainTimerInterval = null;
}

function resetMainTimer() {
    stopMainTimer();
    mainTime = 0;
    document.getElementById('main-timer').innerText = "00:00:00";
    document.getElementById('user-time').value = "";
}

// Font size control for Main Timer
const fontSizeSlider = document.getElementById('font-size-slider');
const mainTimerDisplay = document.getElementById('main-timer');

if (fontSizeSlider) {
    fontSizeSlider.addEventListener('input', function () {
        mainTimerDisplay.style.fontSize = this.value + 'px';
    });
}

function resetFontSize() {
    const defaultSize = 96;
    mainTimerDisplay.style.fontSize = defaultSize + 'px';
    fontSizeSlider.value = defaultSize;
}

// Stopwatch Logic
let stopwatchTime = 0;
let stopwatchInterval = null;

function startStopwatch() {
    if (stopwatchInterval) return;
    stopwatchInterval = setInterval(() => {
        stopwatchTime++;
        updateStopwatchDisplay(stopwatchTime);
    }, 1000);
}

function stopStopwatch() {
    clearInterval(stopwatchInterval);
    stopwatchInterval = null;
}

function resetStopwatch() {
    stopStopwatch();
    stopwatchTime = 0;
    updateStopwatchDisplay(stopwatchTime);
}

function updateStopwatchDisplay(time) {
    const stopwatchDisplay = document.getElementById('stopwatch-display');
    if (stopwatchDisplay) {
        stopwatchDisplay.innerText = formatTime(time);
    }
}

// Break Timer Logic
let breakTimerInterval;
let breakTimeRemaining = 300;

function startBreakTimer() {
    stopBreakTimer(); // Avoid multiple intervals

    breakTimerInterval = setInterval(() => {
        if (breakTimeRemaining > 0) {
            breakTimeRemaining--;
            document.getElementById('break-timer-display').innerText = formatTime(breakTimeRemaining, false);
        } else {
            stopBreakTimer();
            alert("Break is over! Time to get back to work!");
        }
    }, 1000);
}

function stopBreakTimer() {
    clearInterval(breakTimerInterval);
}

function resetBreakTimer() {
    stopBreakTimer();
    breakTimeRemaining = 300;
    document.getElementById('break-timer-display').innerText = "05:00";
}

// Background Upload Logic
let currentBackgroundType = null; // 'image' or 'video'
function uploadBackground() {
    const file = document.getElementById('upload-background')?.files[0];
    const background = document.getElementById('background');
    if (!file || !background) return;
  
    // Clear previous background content
    background.innerHTML = "";
  
    const url = URL.createObjectURL(file);
  
    if (file.type.includes('image')) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = "Background Image";
      img.id = "bg-media";
      background.appendChild(img);
      currentBackgroundType = 'image';
    } else if (file.type.includes('video')) {
      const video = document.createElement('video');
      video.src = url;
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.id = "bg-media";
      background.appendChild(video);
      currentBackgroundType = 'video';
    } else {
      alert("Unsupported background file type!");
    }
  
    stretchBackground(true); // Stretch by default
}
  
function stretchBackground(stretch) {
    const media = document.getElementById('bg-media');
    if (!media) return;
  
    media.style.position = "absolute";
    media.style.top = "0";
    media.style.left = "0";
    media.style.width = stretch ? "100%" : "auto";
    media.style.height = stretch ? "100%" : "auto";
    media.style.objectFit = stretch ? "cover" : "contain";
    media.style.zIndex = "-1";
}

// Music Logic
let music = null;

function uploadMusic() {
    const file = document.getElementById('upload-music')?.files[0];
    if (file) {
        music = new Audio(URL.createObjectURL(file));
    } else {
        alert("No music file selected!");
    }
}

function playMusic() {
    if (music) music.play();
    else alert("No music uploaded!");
}

function pauseMusic() {
    if (music) music.pause();
}

// Toggle Menu
function toggleMenu() {
    const menu = document.getElementById("menu-options");
    const hamburger = document.getElementById("hamburger");

    hamburger.classList.toggle("active");
    menu.classList.toggle("show");
    menu.style.display = menu.classList.contains("show") ? "block" : "none";
}

// Toggle Feature
function toggleFeature(key) {
    const featureMap = {
      'stopwatch': 'stopwatch',
      'break': 'break-timer',
      'bg': 'background-options',
      'music': 'music-options',
      'color': 'color-picker',
      'weather': 'weather',
      'main-timer': 'main-timer-controls'
    };
  
    const featureId = featureMap[key];
    const feature = document.getElementById(featureId);
    const container = document.getElementById("features-container");
  
    if (!feature) return;
  
    if (feature.classList.contains("hidden")) {
      feature.classList.remove("hidden");
      container.classList.remove("hidden");
    } else {
      feature.classList.add("hidden");
  
      const allHidden = Array.from(container.querySelectorAll(".feature"))
        .every((child) => child.classList.contains("hidden"));
  
      if (allHidden) container.classList.add("hidden");
    }
  }

// Timer Color Change
function changeTimerColor() {
    const color = document.getElementById('timer-color')?.value;
    const timer = document.getElementById('main-timer');
    if (timer && color) {
      timer.style.color = color;
    }
}
  
// Use OpenCage for accurate human-readable location
async function getAccurateLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject("Geolocation not supported.");
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lon = position.coords.longitude;
  
          try {
            const res = await fetch(`https://api.opencagedata.com/geocode/v1/json?q=${lat}+${lon}&key=02194fd7350a4b24b543e1140aec05e2`);
            const data = await res.json();
            const components = data.results[0].components;
            const locationName = `${components.suburb || components.city || components.town || components.village || "Unknown"}, ${components.state || ""}`;
            resolve({ lat, lon, locationName });
          } catch (err) {
            reject("Reverse geocoding failed.");
          }
        },
        () => reject("User denied geolocation.")
      );
    });
}  
  
// Weather Update
async function fetchWeather() {
    const weatherElement = document.getElementById('weather');
  
    try {
      const { lat, lon, locationName } = await getAccurateLocation(); // from previous answer
  
      const response = await fetch(
        `https://api.weatherapi.com/v1/forecast.json?key=f7cd48c33ff14fe6b21211010251801&q=${lat},${lon}&days=1&aqi=yes`
      );
      if (!response.ok) throw new Error("Weather API error");
  
      const data = await response.json();
      const { temp_c, condition, wind_kph, air_quality } = data.current;
      const { sunrise, sunset } = data.forecast.forecastday[0].astro;
  
      const aqi = air_quality?.["pm2_5"]?.toFixed(1) || "N/A"; // PM2.5 concentration
  
      weatherElement.innerHTML = `
        <div class="weather-box">
          <img src="https:${condition.icon}" alt="${condition.text}" class="weather-icon" />
          <div class="weather-text">
            <strong>${locationName}</strong><br/>
            🌡 ${temp_c}°C, ${condition.text}<br/>
            💨 Wind: ${wind_kph} kph<br/>
            🌫 AQI (PM2.5): ${aqi}<br/>
            🌅 Sunrise: ${sunrise}<br/>
            🌇 Sunset: ${sunset}
          </div>
        </div>
      `;
    } catch (error) {
      weatherElement.innerText = "Unable to fetch weather.";
    }
}
  
  
  
fetchWeather();

