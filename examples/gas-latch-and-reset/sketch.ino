// Gas Leak Shutoff: a latched safety system.
const int gasPin = A1;
const int valvePin = 8;
const int buzzerPin = 7;
const int resetPin = 2;

const int tripLevel = 400;    // gas concentration that trips the valve
const int clearLevel = 250;   // must fall below this before a reset is allowed

bool latched = false;

void setup() {
  pinMode(valvePin, OUTPUT);
  pinMode(buzzerPin, OUTPUT);
  pinMode(resetPin, INPUT_PULLUP);
  digitalWrite(valvePin, HIGH);   // active LOW relay: valve open
  Serial.begin(9600);
}

void loop() {
  int gas = analogRead(gasPin);
  Serial.println(gas);

  if (gas > tripLevel) latched = true;

  if (latched) {
    digitalWrite(valvePin, LOW);      // close the valve
    digitalWrite(buzzerPin, HIGH);    // and sound the alarm
  } else {
    digitalWrite(valvePin, HIGH);
    digitalWrite(buzzerPin, LOW);
  }

  // A reset only works once the air has actually cleared.
  if (latched && digitalRead(resetPin) == LOW && gas < clearLevel) {
    latched = false;
    delay(400);
  }
  delay(100);
}
