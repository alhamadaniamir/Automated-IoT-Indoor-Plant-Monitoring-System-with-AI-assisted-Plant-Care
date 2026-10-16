import 'package:flutter/material.dart';
import 'device/plant_device.dart';

class PlantDetails extends StatefulWidget {
  const PlantDetails({super.key, required this.link, required this.index});
  final DeviceLink link;
  final int index;
  @override
  State<PlantDetails> createState() => _PlantDetailsState();
}

class _PlantDetailsState extends State<PlantDetails> {
  String species = 'pothos';
  bool schedule = false;
  TimeOfDay time = const TimeOfDay(hour: 8, minute: 0);
  int seconds = 3;
  @override
  void initState() {
    super.initState();
    species = speciesNames.keys.elementAt(widget.index);
    final plant = widget.link.snapshot?.plants[widget.index];
    if (plant != null) {
      species = plant.species;
      schedule = plant.scheduleEnabled;
      time = TimeOfDay(hour: plant.hour, minute: plant.minute);
      seconds = plant.seconds;
    }
  }

  Future<void> send(
    String path,
    Map<String, String> fields,
    String success,
  ) async {
    try {
      await widget.link.send(path, {'plant': '${widget.index + 1}', ...fields});
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(success)));
      }
    } catch (failure) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              failure is DeviceCommandException
                  ? failure.message
                  : 'No confirmation received. Check the plant system before trying again.',
            ),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text('Plant ${widget.index + 1}')),
    body: ListenableBuilder(
      listenable: widget.link,
      builder: (context, _) {
        final plant = widget.link.snapshot?.plants[widget.index];
        final online = widget.link.connected && !widget.link.commandBusy;
        final ready =
            online &&
            widget.link.snapshot!.outputsEnabled &&
            plant?.calibrated == true &&
            plant!.faults.isEmpty;
        return Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 620),
            child: ListView(
              padding: const EdgeInsets.all(20),
              children: [
                DropdownButtonFormField<String>(
                  initialValue: species,
                  decoration: const InputDecoration(
                    labelText: 'Choose your plant',
                    border: OutlineInputBorder(),
                  ),
                  items: speciesNames.entries
                      .map(
                        (item) => DropdownMenuItem(
                          value: item.key,
                          child: Text(item.value),
                        ),
                      )
                      .toList(),
                  onChanged: widget.link.commandBusy
                      ? null
                      : (value) => setState(() => species = value!),
                ),
                const SizedBox(height: 18),
                card(
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'What this plant needs',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        speciesGuides[species]!,
                        style: const TextStyle(height: 1.5),
                      ),
                      const SizedBox(height: 10),
                      const Text(
                        'General care guide · AI advice is not connected yet',
                        style: TextStyle(fontSize: 11, color: Colors.black54),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
                const Text(
                  'Watering',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 8),
                Text(
                  'Water for $seconds seconds',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                Slider(
                  value: seconds.toDouble(),
                  min: 1,
                  max: 5,
                  divisions: 4,
                  label: '$seconds seconds',
                  onChanged: online
                      ? (value) => setState(() => seconds = value.round())
                      : null,
                ),
                FilledButton.icon(
                  onPressed: ready
                      ? () => send(
                          '/api/water',
                          {'seconds': '$seconds'},
                          'Watering request accepted. Your device checks the soil before starting.',
                        )
                      : null,
                  icon: const Icon(Icons.water_drop_outlined),
                  label: const Text('Water now'),
                ),
                if (!ready)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      !online
                          ? 'Connect your plant system to use watering controls.'
                          : 'Confirm relay setup and sensor calibration in the sketch to enable watering.',
                      style: const TextStyle(
                        fontSize: 12,
                        color: Colors.black54,
                      ),
                    ),
                  ),
                const SizedBox(height: 20),
                card(
                  Column(
                    children: [
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Daily watering'),
                        subtitle: const Text(
                          'Waters only when the soil is dry.',
                        ),
                        value: schedule,
                        onChanged: ready || (online && schedule)
                            ? (value) => setState(() => schedule = value)
                            : null,
                      ),
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: const Icon(Icons.schedule_rounded),
                        title: Text(time.format(context)),
                        subtitle: const Text('Time on your phone when saved'),
                        trailing: const Icon(Icons.edit_outlined, size: 19),
                        onTap: online
                            ? () async {
                                final result = await showTimePicker(
                                  context: context,
                                  initialTime: time,
                                );
                                if (result != null && mounted) {
                                  setState(() => time = result);
                                }
                              }
                            : null,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: online
                      ? () => send('/api/plant', {
                          'species': species,
                          'schedule': '$schedule',
                          'hour': '${time.hour}',
                          'minute': '${time.minute}',
                          'seconds': '$seconds',
                        }, 'Plant settings saved on your device.')
                      : null,
                  child: Text(
                    widget.link.commandBusy ? 'Saving…' : 'Save settings',
                  ),
                ),
                const SizedBox(height: 18),
                ExpansionTile(
                  title: const Text(
                    'Sensor details',
                    style: TextStyle(fontSize: 14),
                  ),
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(
                        plant == null
                            ? 'No readings received yet.'
                            : '${widget.link.connected ? 'Live' : 'Saved'} reading\nRaw soil reading: ${plant.raw ?? 'unavailable'}\nSensor: GPIO${plant.sensorPin} · Relay: GPIO${plant.relayPin}\nCalibration: ${plant.calibrated ? 'configured' : 'needed'}\nDevice status: ${plant.faults.isEmpty ? 'no fault reported' : plant.faults.join(', ')}\n\nPump state is its relay command, not measured water flow. Schedules pause after a restart until the phone reconnects to set the clock.',
                        style: const TextStyle(fontSize: 12, height: 1.6),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    ),
  );
  Widget card(Widget child) => Container(
    padding: const EdgeInsets.all(17),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
    ),
    child: child,
  );
}
