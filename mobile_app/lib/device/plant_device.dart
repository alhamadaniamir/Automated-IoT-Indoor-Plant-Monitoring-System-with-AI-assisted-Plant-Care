import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';

const speciesNames = {
  'pothos': 'Pothos',
  'snake_plant': 'Snake plant',
  'peace_lily': 'Peace lily',
};
const speciesGuides = {
  'pothos':
      'Indirect light. Let the soil dry moderately between waterings. Use a pot with drainage.',
  'snake_plant':
      'Indirect light. Let the soil dry between waterings; avoid keeping it wet. Use freely draining soil.',
  'peace_lily':
      'Indirect light. Keep soil lightly moist, without leaving it soggy. Let it dry somewhat between waterings.',
};

class PlantReading {
  PlantReading(Map<String, dynamic> data)
    : id = _int(data['id'], 1, 3),
      species = data['species'] as String,
      raw = data['soil_raw'] == null ? null : _int(data['soil_raw'], 0, 4095),
      percent = data['soil_moisture_pct'] == null
          ? null
          : (data['soil_moisture_pct'] as num).toDouble(),
      calibrated = data['calibrated'] as bool,
      pump = data['pump_running'] as bool?,
      faults = List<String>.from(data['faults'] as List),
      sensorPin = _int(data['sensor_pin'], 0, 48),
      relayPin = _int(data['relay_pin'], 0, 48),
      scheduleEnabled = data['schedule_enabled'] as bool,
      hour = _int(data['schedule_hour'], 0, 23),
      minute = _int(data['schedule_minute'], 0, 59),
      seconds = _int(data['watering_seconds'], 1, 5) {
    if (!speciesNames.containsKey(species) ||
        (percent != null &&
            (!percent!.isFinite ||
                percent! < 0 ||
                percent! > 100 ||
                !calibrated ||
                raw == null)) ||
        faults.any((fault) => fault.isEmpty)) {
      throw const FormatException('Invalid plant telemetry.');
    }
  }
  final int id, sensorPin, relayPin, hour, minute, seconds;
  final String species;
  final int? raw;
  final double? percent;
  final bool calibrated, scheduleEnabled;
  final bool? pump;
  final List<String> faults;
  String get name => speciesNames[species]!;
}

class DeviceSnapshot {
  DeviceSnapshot.fromJson(Object? json) {
    if (json is! Map<String, dynamic> ||
        json['schema_version'] != 1 ||
        json['source'] != 'device') {
      throw const FormatException(
        'Upload the updated plant-system Arduino sketch.',
      );
    }
    deviceId = json['device_id'] as String;
    bootId = json['boot_id'] as String;
    sequence = _int(json['sample_sequence'], 0, 0xffffffff);
    sampleAgeMs = _int(json['sample_age_ms'], 0, 0xffffffff);
    outputsEnabled = json['pump_outputs_enabled'] as bool;
    clockSynced = json['clock_synced'] as bool;
    plants = (json['plants'] as List)
        .map((item) => PlantReading(item as Map<String, dynamic>))
        .toList();
    if (deviceId.isEmpty ||
        bootId.isEmpty ||
        plants.length != 3 ||
        plants.map((plant) => plant.id).toSet().length != 3 ||
        (!outputsEnabled && plants.any((plant) => plant.pump != null))) {
      throw const FormatException('Invalid plant-device response.');
    }
    plants.sort((a, b) => a.id.compareTo(b.id));
  }
  late final String deviceId, bootId;
  late final int sequence, sampleAgeMs;
  late final bool outputsEnabled, clockSynced;
  late final List<PlantReading> plants;
}

int _int(Object? value, int min, int max) {
  if (value is! int || value < min || value > max) {
    throw const FormatException('Invalid device value.');
  }
  return value;
}

abstract interface class DeviceApi {
  Future<DeviceSnapshot> read();
  Future<void> command(String path, Map<String, String> fields);
  void close();
}

class Esp32Api implements DeviceApi {
  Esp32Api({Uri? base, this.timeout = const Duration(seconds: 4)})
    : base = base ?? Uri.parse('http://192.168.4.1');
  final Uri base;
  final Duration timeout;
  final Set<HttpClient> _clients = {};

  Future<Object?> _request(String path, Map<String, String>? fields) async {
    final client = HttpClient()..connectionTimeout = timeout;
    _clients.add(client);
    try {
      return await (() async {
        final request = await client.openUrl(
          fields == null ? 'GET' : 'POST',
          base.resolve(path),
        );
        request.followRedirects = false;
        request.headers.set(HttpHeaders.acceptHeader, 'application/json');
        request.headers.set(HttpHeaders.cacheControlHeader, 'no-cache');
        request.headers.set('X-PlantCare-Client', 'mobile-v1');
        if (fields != null) {
          request.headers.contentType = ContentType(
            'application',
            'x-www-form-urlencoded',
            charset: 'utf-8',
          );
          request.write(Uri(queryParameters: fields).query);
        }
        final response = await request.close();
        final bytes = <int>[];
        await for (final chunk in response) {
          bytes.addAll(chunk);
          if (bytes.length > 16384) {
            throw const FormatException('Device response is too large.');
          }
        }
        if (response.headers.contentType?.mimeType != 'application/json') {
          throw const FormatException(
            'The connected device is not serving plant telemetry.',
          );
        }
        final data = jsonDecode(utf8.decode(bytes));
        if (response.statusCode != 200) {
          final message = data is Map && data['error'] is String
              ? data['error'] as String
              : 'Device rejected the request.';
          throw DeviceCommandException(message);
        }
        return data;
      })().timeout(timeout);
    } finally {
      client.close(force: true);
      _clients.remove(client);
    }
  }

  @override
  Future<DeviceSnapshot> read() async =>
      DeviceSnapshot.fromJson(await _request('/api/telemetry', null));
  @override
  Future<void> command(String path, Map<String, String> fields) async {
    await _request(path, fields);
  }

  @override
  void close() {
    for (final client in _clients) {
      client.close(force: true);
    }
    _clients.clear();
  }
}

class DeviceCommandException implements Exception {
  const DeviceCommandException(this.message);
  final String message;
  @override
  String toString() => message;
}

class DeviceLink extends ChangeNotifier {
  DeviceLink({DeviceApi? api, this.pollInterval = const Duration(seconds: 2)})
    : _api = api ?? Esp32Api();
  final DeviceApi _api;
  final Duration pollInterval;
  DeviceSnapshot? snapshot;
  DateTime? lastReceivedAt, _sequenceChangedAt;
  bool connected = false, connecting = false, commandBusy = false;
  String? error;
  bool _wanted = false, _busy = false, _disposed = false;
  int _generation = 0;
  Timer? _timer;
  bool get wantsConnection => _wanted;

  Future<void> connect() async {
    if (_wanted || _disposed) return;
    _wanted = true;
    _generation++;
    _timer = Timer.periodic(pollInterval, (_) => refresh());
    await refresh();
  }

  Future<void> refresh() async {
    if (_disposed || !_wanted || _busy) return;
    final generation = _generation;
    _busy = true;
    connecting = !connected;
    notifyListeners();
    try {
      final next = await _api.read();
      if (_disposed || generation != _generation) return;
      final now = DateTime.now();
      if (snapshot?.bootId != next.bootId ||
          snapshot?.sequence != next.sequence) {
        _sequenceChangedAt = now;
      }
      if (next.sampleAgeMs > 10000 ||
          (_sequenceChangedAt != null &&
              now.difference(_sequenceChangedAt!).inSeconds >= 10)) {
        throw const FormatException('Sensor updates have stopped.');
      }
      if (!next.clockSynced) {
        await _api.command('/api/time', {
          'epoch': '${now.millisecondsSinceEpoch ~/ 1000}',
          'offset': '${now.timeZoneOffset.inMinutes}',
        });
      }
      if (_disposed || generation != _generation) return;
      snapshot = next;
      connected = true;
      lastReceivedAt = now;
      error = null;
    } catch (failure) {
      if (_disposed || generation != _generation) return;
      connected = false;
      error = failure is FormatException
          ? failure.message
          : 'Cannot reach your plant system. Check the PlantCare Wi-Fi connection.';
    } finally {
      _busy = false;
      if (!_disposed && generation == _generation) {
        connecting = false;
        notifyListeners();
      }
    }
  }

  Future<void> send(String path, Map<String, String> fields) async {
    if (!connected || commandBusy) {
      throw const DeviceCommandException('Connect to your plant system first.');
    }
    final generation = _generation;
    commandBusy = true;
    notifyListeners();
    try {
      // Do not retry a pump command: a lost response does not mean it was not run.
      await _api.command(path, fields);
      if (!_disposed && generation == _generation) await refresh();
    } finally {
      commandBusy = false;
      if (!_disposed) notifyListeners();
    }
  }

  void disconnect() {
    _wanted = false;
    _generation++;
    _timer?.cancel();
    _api.close();
    connected = connecting = false;
    error = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    _timer?.cancel();
    _api.close();
    super.dispose();
  }
}
