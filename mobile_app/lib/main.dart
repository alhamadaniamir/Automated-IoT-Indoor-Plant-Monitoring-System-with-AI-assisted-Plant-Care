import 'package:flutter/material.dart';
import 'device/plant_device.dart';
import 'plant_details.dart';

void main() => runApp(const PlantCareApp());
const forest = Color(0xFF245C45);

class PlantCareApp extends StatelessWidget {
  const PlantCareApp({super.key, this.deviceLink});
  final DeviceLink? deviceLink;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Sprout — Plant Care',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      scaffoldBackgroundColor: const Color(0xFFF6F7F2),
      colorScheme: ColorScheme.fromSeed(seedColor: forest, primary: forest),
    ),
    home: PlantDashboard(deviceLink: deviceLink),
  );
}

class PlantDashboard extends StatefulWidget {
  const PlantDashboard({super.key, this.deviceLink});
  final DeviceLink? deviceLink;
  @override
  State<PlantDashboard> createState() => _PlantDashboardState();
}

class _PlantDashboardState extends State<PlantDashboard> {
  late final DeviceLink link;
  @override
  void initState() {
    super.initState();
    link = widget.deviceLink ?? DeviceLink();
  }

  @override
  void dispose() {
    if (widget.deviceLink == null) link.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      backgroundColor: const Color(0xFFF6F7F2),
      title: const Row(
        children: [
          Icon(Icons.eco_rounded, color: forest),
          SizedBox(width: 9),
          Text('sprout', style: TextStyle(fontWeight: FontWeight.w800)),
        ],
      ),
      actions: [
        IconButton(
          tooltip: 'Connection setup',
          onPressed: setup,
          icon: const Icon(Icons.settings_outlined),
        ),
      ],
    ),
    body: SafeArea(
      top: false,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 620),
          child: ListenableBuilder(
            listenable: link,
            builder: (context, _) => RefreshIndicator(
              onRefresh: link.wantsConnection ? link.refresh : link.connect,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(20),
                children: [
                  const Text(
                    'Your plants',
                    style: TextStyle(fontSize: 29, fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 5),
                  const Text(
                    'A little care, every day.',
                    style: TextStyle(color: Colors.black54),
                  ),
                  const SizedBox(height: 22),
                  connectionCard(),
                  const SizedBox(height: 20),
                  ...List.generate(3, plantCard),
                  const Text(
                    'Tap a plant to choose its type, water it, or set a schedule.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.black54, fontSize: 12),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );

  Widget connectionCard() => Container(
    padding: const EdgeInsets.all(19),
    decoration: BoxDecoration(
      color: forest,
      borderRadius: BorderRadius.circular(22),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(
              link.connected ? Icons.wifi_rounded : Icons.wifi_off_rounded,
              color: const Color(0xFFDDE9B9),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                link.connected
                    ? 'Your plants are connected'
                    : link.connecting
                    ? 'Connecting…'
                    : link.wantsConnection
                    ? 'Connection interrupted'
                    : 'Let’s connect your plants',
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                  fontSize: 17,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 9),
        Text(
          link.connected
              ? 'Readings update automatically.'
              : link.wantsConnection
              ? 'Trying again. Check your PlantCare Wi-Fi connection.'
              : 'Join your PlantCare Wi-Fi, then tap Connect.',
          style: const TextStyle(
            color: Colors.white70,
            height: 1.4,
            fontSize: 13,
          ),
        ),
        if (!link.connected && link.snapshot != null) ...[
          const SizedBox(height: 8),
          const Text(
            'Showing saved readings, not live data.',
            style: TextStyle(color: Color(0xFFFFD9AA), fontSize: 12),
          ),
        ],
        const SizedBox(height: 12),
        if (!link.wantsConnection)
          FilledButton.icon(
            onPressed: link.connect,
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFE5EDC8),
              foregroundColor: forest,
            ),
            icon: const Icon(Icons.link_rounded, size: 18),
            label: const Text('Connect'),
          )
        else
          TextButton(
            onPressed: setup,
            style: TextButton.styleFrom(foregroundColor: Colors.white),
            child: Text(
              link.connected ? 'Connection settings' : 'Connection help',
            ),
          ),
      ],
    ),
  );

  Widget plantCard(int index) {
    final plant = link.snapshot?.plants[index];
    final percent = plant?.percent;
    final sensorFault =
        plant?.faults.any((fault) => fault.startsWith('adc_')) ?? false;
    final status = plant == null
        ? 'Waiting for a reading'
        : sensorFault
        ? 'Check the soil sensor'
        : !plant.calibrated
        ? 'Moisture sensor needs setup'
        : 'Soil moisture';
    final pump = plant?.pump;
    final watering = pump == null
        ? 'Watering needs setup'
        : !link.connected
        ? 'Last command: ${pump ? 'water on' : 'water off'}'
        : pump
        ? 'Watering now'
        : plant!.scheduleEnabled
        ? 'Daily at ${plant.hour.toString().padLeft(2, '0')}:${plant.minute.toString().padLeft(2, '0')}'
        : 'No watering schedule';
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        child: InkWell(
          borderRadius: BorderRadius.circular(22),
          onTap: () => Navigator.push(
            context,
            MaterialPageRoute<void>(
              builder: (_) => PlantDetails(link: link, index: index),
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.all(19),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 45,
                      height: 45,
                      decoration: BoxDecoration(
                        color: const Color(0xFFEBF0E4),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Icon(
                        [
                          Icons.spa_outlined,
                          Icons.grass_rounded,
                          Icons.local_florist_outlined,
                        ][index],
                        color: forest,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            plant?.name ??
                                speciesNames[speciesNames.keys.elementAt(
                                  index,
                                )]!,
                            style: const TextStyle(
                              fontSize: 19,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          Text(
                            'Plant ${index + 1}',
                            style: const TextStyle(
                              fontSize: 11,
                              color: Colors.black45,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const Icon(
                      Icons.chevron_right_rounded,
                      color: Colors.black38,
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        status,
                        style: const TextStyle(
                          fontSize: 13,
                          color: Colors.black54,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      percent == null ? '—' : '${percent.toStringAsFixed(0)}%',
                      style: TextStyle(
                        fontSize: 27,
                        fontWeight: FontWeight.w800,
                        color: link.connected ? forest : Colors.black38,
                      ),
                    ),
                  ],
                ),
                if (percent != null) ...[
                  const SizedBox(height: 8),
                  LinearProgressIndicator(
                    value: percent / 100,
                    minHeight: 6,
                    borderRadius: BorderRadius.circular(4),
                    color: link.connected ? forest : Colors.grey,
                    backgroundColor: const Color(0xFFEBF0E4),
                  ),
                ],
                const SizedBox(height: 14),
                Row(
                  children: [
                    const Icon(
                      Icons.water_drop_outlined,
                      size: 16,
                      color: Colors.black38,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        watering,
                        style: const TextStyle(
                          fontSize: 12,
                          color: Colors.black54,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void setup() => showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheetContext) => SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
        child: ListenableBuilder(
          listenable: link,
          builder: (context, _) => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Connect your plant system',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 18),
              step(
                '1',
                'Power on the plant system',
                'Upload the updated Arduino sketch first.',
              ),
              step(
                '2',
                'Join its Wi-Fi on your phone',
                'Choose the PlantCare network. Find its password in Arduino Serial Monitor at 115200 baud. Stay connected if Android says “No internet”.',
              ),
              step(
                '3',
                'Return here and tap Connect',
                'Your three plants will appear automatically.',
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () {
                    final disconnect = link.wantsConnection;
                    Navigator.pop(sheetContext);
                    if (disconnect) {
                      link.disconnect();
                    } else {
                      link.connect();
                    }
                  },
                  child: Text(link.wantsConnection ? 'Disconnect' : 'Connect'),
                ),
              ),
              if (link.error != null)
                ExpansionTile(
                  title: const Text('Connection details'),
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(
                        link.error!,
                        style: const TextStyle(fontSize: 12),
                      ),
                    ),
                  ],
                ),
            ],
          ),
        ),
      ),
    ),
  );

  Widget step(String number, String title, String text) => Padding(
    padding: const EdgeInsets.only(bottom: 16),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        CircleAvatar(
          radius: 14,
          backgroundColor: const Color(0xFFE8F1E9),
          child: Text(
            number,
            style: const TextStyle(color: forest, fontSize: 13),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              Text(
                text,
                style: const TextStyle(
                  color: Colors.black54,
                  fontSize: 13,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}
