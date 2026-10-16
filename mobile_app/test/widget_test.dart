import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:plant_care_mobile/main.dart';

void main() {
  testWidgets('plant overview renders preview status and care insight', (
    tester,
  ) async {
    await tester.pumpWidget(const PlantCareApp());

    expect(find.text('Your little green corner'), findsOneWidget);
    expect(find.text('MONSTERA DELICIOSA'), findsOneWidget);
    expect(find.textContaining('hardware not connected'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('A little plant insight'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('A little plant insight'), findsOneWidget);
  });
}
