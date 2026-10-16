import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:plant_care_mobile/device/plant_device.dart';

Map<String, dynamic> deviceFixture() =>
    jsonDecode(File('test/fixtures/device.json').readAsStringSync())
        as Map<String, dynamic>;

class FakeDevice implements DeviceApi {
  bool failRead = false, failCommand = false;
  Map<String, dynamic> data = deviceFixture();
  final commands = <(String, Map<String, String>)>[];
  @override
  Future<DeviceSnapshot> read() async {
    if (failRead) throw const SocketException('disconnected');
    return DeviceSnapshot.fromJson(data);
  }

  @override
  Future<void> command(String path, Map<String, String> fields) async {
    commands.add((path, fields));
    if (failCommand) throw TimeoutException('lost reply');
  }

  @override
  void close() {}
}

void main() {
  test('uncalibrated readings remain raw, with independent channel faults', () {
    final device = DeviceSnapshot.fromJson(deviceFixture());
    expect(device.plants.map((plant) => plant.raw), [2700, 1800, 0]);
    expect(device.plants.every((plant) => plant.percent == null), isTrue);
    expect(device.plants[0].faults, isEmpty);
    expect(device.plants[2].faults, ['adc_saturated']);
  });
  test(
    'rejects simulator records, duplicate channels, and invented percentages',
    () {
      final simulator = deviceFixture()..['source'] = 'simulator';
      expect(() => DeviceSnapshot.fromJson(simulator), throwsFormatException);
      final duplicate = deviceFixture();
      duplicate['plants'][1]['id'] = 1;
      expect(() => DeviceSnapshot.fromJson(duplicate), throwsFormatException);
      final invented = deviceFixture();
      invented['plants'][0]['soil_moisture_pct'] = 50;
      expect(() => DeviceSnapshot.fromJson(invented), throwsFormatException);
    },
  );
  test(
    'connection loss preserves last reading and blocks watering commands',
    () async {
      final api = FakeDevice();
      final link = DeviceLink(api: api);
      addTearDown(link.dispose);
      await link.connect();
      expect(link.connected, isTrue);
      api.failRead = true;
      await link.refresh();
      expect(link.connected, isFalse);
      expect(link.snapshot!.plants[0].raw, 2700);
      await expectLater(
        link.send('/api/water', {'plant': '1', 'seconds': '3'}),
        throwsA(isA<DeviceCommandException>()),
      );
      expect(api.commands, isEmpty);
    },
  );
  test(
    'syncs a restarted device clock without retrying a lost pump request',
    () async {
      final api = FakeDevice();
      api.data['clock_synced'] = false;
      final link = DeviceLink(api: api);
      addTearDown(link.dispose);
      await link.connect();
      expect(api.commands.single.$1, '/api/time');
      api.commands.clear();
      api.failCommand = true;
      await expectLater(
        link.send('/api/water', {'plant': '1', 'seconds': '3'}),
        throwsA(isA<TimeoutException>()),
      );
      expect(api.commands.length, 1);
    },
  );
  test(
    'HTTP adapter reads firmware JSON and sends form commands with client header',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      final requests = <String>[];
      final bodies = <String>[];
      server.listen((request) async {
        requests.add(request.uri.path);
        expect(request.headers.value('X-PlantCare-Client'), 'mobile-v1');
        bodies.add(await utf8.decoder.bind(request).join());
        request.response.headers.contentType = ContentType.json;
        request.response.write(
          jsonEncode(request.method == 'GET' ? deviceFixture() : {'ok': true}),
        );
        await request.response.close();
      });
      final api = Esp32Api(base: Uri.parse('http://127.0.0.1:${server.port}'));
      addTearDown(api.close);
      expect((await api.read()).plants.length, 3);
      await api.command('/api/plant', {
        'plant': '2',
        'species': 'snake_plant',
        'schedule': 'true',
        'hour': '8',
        'minute': '30',
        'seconds': '2',
      });
      expect(requests, ['/api/telemetry', '/api/plant']);
      expect(Uri.splitQueryString(bodies.last)['species'], 'snake_plant');
      expect(Uri.splitQueryString(bodies.last)['minute'], '30');
    },
  );
}
