# Example Arduino Firmware

This folder contains sample Arduino sketches for testing the Web Serial Plotter.

## basic_plotter.ino

A basic example that generates simulated sensor data with 4 series:
- Temperature (°C)
- Humidity (%)
- Pressure (hPa)
- Light (lux)

### Features
- Outputs data at 10 Hz (100ms intervals)
- Uses sine waves with random noise for realistic sensor simulation
- Includes proper header line with series names
- Compatible with standard Arduino boards (Uno, Nano, ESP32, etc.)

### Upload Instructions

1. Open `basic_plotter.ino` in Arduino IDE
2. Select your board and COM port
3. Upload the sketch
4. Open the Web Serial Plotter in your browser
5. Click "Connect" and select the Arduino's serial port
6. Use default settings: 115200 baud, 8 data bits, 1 stop bit, no parity

### Data Format

The sketch outputs data in the format expected by the Web Serial Plotter:

```
# Temperature,Humidity,Pressure,Light
22.45,65.23,1015.67,789.12
22.67,64.89,1015.23,792.45
...
```

- Header line starts with `#` followed by comma-separated series names
- Data lines contain comma-separated numerical values
- Each line represents one time sample across all series

### Customization

You can modify the sketch to:
- Change the number of data series
- Adjust sampling rate (modify `delay()` value)
- Change data generation functions
- Add real sensor readings instead of simulated data

### Serial Settings

- **Baud Rate**: 115200
- **Data Bits**: 8
- **Stop Bits**: 1
- **Parity**: None
- **Flow Control**: None