#include <DHT.h>
#include <LiquidCrystal_I2C.h>
#include <Servo.h>

#define DHTPIN 2
#define DHTTYPE DHT11

DHT dht(DHTPIN, DHTTYPE);
LiquidCrystal_I2C lcd(0x27, 16, 2);
Servo vent;

const int soilPin = A1;
const int pumpPin = 8;

const float ventAbove = 28.0;     // open the vent when hotter than this
const float ventBelow = 24.0;     // and close it again below this
const int drySoil = 300;          // water when the soil reads drier than this

bool ventOpen = false;

void setup() {
  dht.begin();
  lcd.init();
  lcd.backlight();
  vent.attach(9);
  vent.write(0);                  // closed
  pinMode(pumpPin, OUTPUT);
  digitalWrite(pumpPin, HIGH);    // active LOW relay: pump off
  Serial.begin(9600);
}

void loop() {
  float t = dht.readTemperature();
  int soil = analogRead(soilPin);

  if (!ventOpen && t > ventAbove) { vent.write(90); ventOpen = true; }
  else if (ventOpen && t < ventBelow) { vent.write(0); ventOpen = false; }

  if (soil < drySoil) digitalWrite(pumpPin, LOW);
  else digitalWrite(pumpPin, HIGH);

  lcd.setCursor(0, 0);
  lcd.print("T:");
  lcd.print(t);
  lcd.print("C  V:");
  lcd.print(ventOpen ? "open " : "shut ");

  lcd.setCursor(0, 1);
  lcd.print("soil ");
  lcd.print(soil);
  lcd.print("     ");

  Serial.print(t);
  Serial.print(" C, soil ");
  Serial.println(soil);
  delay(500);
}
