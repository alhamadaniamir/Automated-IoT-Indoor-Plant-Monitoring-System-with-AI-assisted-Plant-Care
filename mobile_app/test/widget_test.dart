import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:plant_care_mobile/main.dart';
import 'package:plant_care_mobile/device/plant_device.dart';
import 'device_link_test.dart' show FakeDevice;

void main() {
  testWidgets('each starter plant care guide is available while offline', (
    tester,
  ) async {
    await tester.pumpWidget(const PlantCareApp());
    await tester.ensureVisible(find.text('Snake plant'));
    await tester.tap(find.text('Snake plant'));
    await tester.pumpAndSettle();
    expect(find.text(speciesGuides['snake_plant']!), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Water now'))
          .onPressed,
      isNull,
    );
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets('daily schedule saves the selected plant and bounded duration', (
    tester,
  ) async {
    final api = FakeDevice();
    api.data['pump_outputs_enabled'] = true;
    for (final item in api.data['plants'] as List) {
      item['calibrated'] = true;
      item['soil_moisture_pct'] = 30;
      item['pump_running'] = false;
      item['faults'] = <String>[];
    }
    final link = DeviceLink(api: api);
    addTearDown(link.dispose);
    await link.connect();
    await tester.pumpWidget(PlantCareApp(deviceLink: link));
    await tester.tap(find.text('Pothos'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byType(Switch));
    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Save settings'));
    await tester.tap(find.text('Save settings'));
    await tester.pumpAndSettle();
    expect(api.commands.single.$1, '/api/plant');
    expect(api.commands.single.$2, {
      'plant': '1',
      'species': 'pothos',
      'schedule': 'true',
      'hour': '8',
      'minute': '0',
      'seconds': '3',
    });
    link.disconnect();
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets(
    'starter profiles show immediately, with live status only after connection',
    (tester) async {
      final link = DeviceLink(api: FakeDevice());
      addTearDown(link.dispose);
      await tester.pumpWidget(PlantCareApp(deviceLink: link));
      expect(find.text('Your plants'), findsOneWidget);
      expect(find.text('Plant 1'), findsOneWidget);
      expect(find.text('Pothos'), findsOneWidget);
      expect(find.text('Your plants are connected'), findsNothing);
      expect(find.text('Overview'), findsNothing);
      await tester.tap(find.text('Connect'));
      await tester.pumpAndSettle();
      expect(find.text('Pothos'), findsOneWidget);
      expect(find.text('Snake plant'), findsOneWidget);
      await tester.tap(find.text('Pothos'));
      await tester.pumpAndSettle();
      expect(find.text('What this plant needs'), findsOneWidget);
      final water = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Water now'),
      );
      expect(water.onPressed, isNull); // A monitor-only sketch cannot water.
      expect(
        find.textContaining('Raw soil reading'),
        findsNothing,
      ); // Details stay collapsed.
      link.disconnect();
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
  testWidgets('water action sends a bounded command for the selected plant', (
    tester,
  ) async {
    final api = FakeDevice();
    api.data['pump_outputs_enabled'] = true;
    for (final item in api.data['plants'] as List) {
      item['calibrated'] = true;
      item['soil_moisture_pct'] = 30;
      item['pump_running'] = false;
      item['faults'] = <String>[];
    }
    final link = DeviceLink(api: api);
    addTearDown(link.dispose);
    await link.connect();
    await tester.pumpWidget(PlantCareApp(deviceLink: link));
    await tester.tap(find.text('Snake plant'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Water now'));
    await tester.pumpAndSettle();
    expect(api.commands.single.$1, '/api/water');
    expect(api.commands.single.$2, {'plant': '2', 'seconds': '3'});
    link.disconnect();
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
