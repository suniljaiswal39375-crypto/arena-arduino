// Serial command console: type "on" or "off" in the monitor.
String command = "";

void setup() {
  pinMode(13, OUTPUT);
  Serial.begin(9600);
  Serial.println("ready");
}

void loop() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\n') {
      command.trim();
      if (command == "on") {
        digitalWrite(13, HIGH);
        Serial.println("LED on");
      } else if (command == "off") {
        digitalWrite(13, LOW);
        Serial.println("LED off");
      } else {
        Serial.println("unknown command");
      }
      command = "";
    } else {
      command += c;
    }
  }
}
