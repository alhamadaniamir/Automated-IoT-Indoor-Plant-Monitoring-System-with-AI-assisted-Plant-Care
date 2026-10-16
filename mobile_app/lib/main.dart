import 'package:flutter/material.dart';

void main() => runApp(const PlantCareApp());

class PlantCareApp extends StatelessWidget {
  const PlantCareApp({super.key});

  @override
  Widget build(BuildContext context) {
    const forest = Color(0xFF245C45);
    return MaterialApp(
      title: 'Sprout — Plant Care',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFFF6F7F2),
        colorScheme: ColorScheme.fromSeed(
          seedColor: forest,
          primary: forest,
          surface: const Color(0xFFF6F7F2),
        ),
        fontFamily: 'Roboto',
      ),
      home: const PlantDashboard(),
    );
  }
}

class PlantDashboard extends StatefulWidget {
  const PlantDashboard({super.key});

  @override
  State<PlantDashboard> createState() => _PlantDashboardState();
}

class _PlantDashboardState extends State<PlantDashboard> {
  int _selectedTab = 0;
  int _moisture = 38;
  bool _pumpRunning = false;

  void _waterPlant() {
    setState(() {
      _pumpRunning = !_pumpRunning;
      if (_pumpRunning) _moisture = (_moisture + 8).clamp(0, 100);
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          _pumpRunning
              ? 'Demo: watering started. Hardware is not connected yet.'
              : 'Demo: watering stopped.',
        ),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isHome = _selectedTab == 0;
    return Scaffold(
      appBar: AppBar(
        backgroundColor: const Color(0xFFF6F7F2),
        titleSpacing: 22,
        title: const Row(
          children: [
            Icon(Icons.eco_rounded, color: Color(0xFF245C45), size: 27),
            SizedBox(width: 9),
            Text('sprout', style: TextStyle(fontWeight: FontWeight.w800)),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Notifications',
            onPressed: () => _showMessage('You are all caught up.'),
            icon: const Badge(
              smallSize: 8,
              child: Icon(Icons.notifications_none_rounded),
            ),
          ),
          const Padding(
            padding: EdgeInsets.only(left: 4, right: 20),
            child: CircleAvatar(
              radius: 17,
              backgroundColor: Color(0xFFE3EBDD),
              child: Icon(
                Icons.person_outline,
                size: 19,
                color: Color(0xFF245C45),
              ),
            ),
          ),
        ],
      ),
      body: SafeArea(
        top: false,
        child: isHome ? _buildHome() : _buildPlaceholder(),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedTab,
        onDestinationSelected: (index) => setState(() => _selectedTab = index),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.grid_view_rounded),
            label: 'Overview',
          ),
          NavigationDestination(
            icon: Icon(Icons.spa_outlined),
            label: 'My plants',
          ),
          NavigationDestination(
            icon: Icon(Icons.auto_awesome_outlined),
            label: 'Plant AI',
          ),
          NavigationDestination(
            icon: Icon(Icons.tune_rounded),
            label: 'Settings',
          ),
        ],
      ),
    );
  }

  Widget _buildHome() {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 760),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
          children: [
            const Text(
              'Your little green corner',
              style: TextStyle(fontSize: 25, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 5),
            Text(
              'Here is how your plant is doing today.',
              style: TextStyle(color: Colors.grey.shade700, fontSize: 14),
            ),
            const SizedBox(height: 19),
            _connectionBanner(),
            const SizedBox(height: 18),
            _plantCard(),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: _metricCard(
                    'Moisture',
                    '$_moisture%',
                    Icons.water_drop_outlined,
                    const Color(0xFFE8F2EC),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _metricCard(
                    'Temperature',
                    '24°',
                    Icons.thermostat_rounded,
                    const Color(0xFFF4EDE2),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _metricCard(
                    'Humidity',
                    '56%',
                    Icons.air_rounded,
                    const Color(0xFFEAF0F2),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _metricCard(
                    'Light today',
                    '6.2 h',
                    Icons.wb_sunny_outlined,
                    const Color(0xFFF5F1DF),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            _careCard(),
            const SizedBox(height: 18),
            _wateringCard(),
            const SizedBox(height: 18),
            const Text(
              'Recent activity',
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 10),
            _activityRow(
              Icons.sensors_rounded,
              'Sensor reading received',
              'Soil moisture is $_moisture%',
              'Just now',
            ),
            _activityRow(
              Icons.auto_awesome_rounded,
              'Plant care insight',
              'Your Monstera may need a drink soon.',
              'Today · 9:15 AM',
            ),
          ],
        ),
      ),
    );
  }

  Widget _connectionBanner() => Container(
    padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
    decoration: BoxDecoration(
      color: const Color(0xFFE8F1E9),
      borderRadius: BorderRadius.circular(15),
    ),
    child: const Row(
      children: [
        Icon(Icons.info_outline_rounded, size: 19, color: Color(0xFF245C45)),
        SizedBox(width: 9),
        Expanded(
          child: Text(
            'Preview mode · sensor and pump hardware not connected',
            style: TextStyle(fontSize: 12, color: Color(0xFF315A43)),
          ),
        ),
      ],
    ),
  );

  Widget _plantCard() => Container(
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      color: const Color(0xFF245C45),
      borderRadius: BorderRadius.circular(24),
    ),
    child: Row(
      children: [
        Container(
          width: 76,
          height: 76,
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.14),
            borderRadius: BorderRadius.circular(22),
          ),
          child: const Icon(
            Icons.eco_rounded,
            size: 43,
            color: Color(0xFFE0E9B9),
          ),
        ),
        const SizedBox(width: 15),
        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'MONSTERA DELICIOSA',
                style: TextStyle(
                  color: Color(0xFFC8D8C9),
                  fontSize: 10,
                  letterSpacing: 1.3,
                  fontWeight: FontWeight.w700,
                ),
              ),
              SizedBox(height: 5),
              Text(
                'Milo',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 23,
                  fontWeight: FontWeight.w800,
                ),
              ),
              SizedBox(height: 5),
              Text(
                'Looking pretty good today',
                style: TextStyle(color: Color(0xFFE0E9E2), fontSize: 12),
              ),
            ],
          ),
        ),
        const Icon(Icons.chevron_right_rounded, color: Colors.white70),
      ],
    ),
  );

  Widget _metricCard(String label, String value, IconData icon, Color tint) =>
      Container(
        padding: const EdgeInsets.all(15),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(19),
          border: Border.all(color: const Color(0xFFE9EBE5)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 30,
                  height: 30,
                  decoration: BoxDecoration(
                    color: tint,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(icon, size: 17, color: const Color(0xFF315A43)),
                ),
                const Spacer(),
                const Icon(
                  Icons.more_horiz_rounded,
                  size: 19,
                  color: Colors.black38,
                ),
              ],
            ),
            const SizedBox(height: 13),
            Text(
              value,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(fontSize: 12, color: Colors.grey.shade700),
            ),
          ],
        ),
      );

  Widget _careCard() => Container(
    padding: const EdgeInsets.all(17),
    decoration: BoxDecoration(
      color: const Color(0xFFF0EDFA),
      borderRadius: BorderRadius.circular(20),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Row(
          children: [
            Icon(
              Icons.auto_awesome_rounded,
              size: 19,
              color: Color(0xFF65559B),
            ),
            SizedBox(width: 8),
            Text(
              'A little plant insight',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: Color(0xFF352D52),
              ),
            ),
            Spacer(),
            Text(
              'AI CARE',
              style: TextStyle(
                fontSize: 9,
                letterSpacing: 1.1,
                fontWeight: FontWeight.w800,
                color: Color(0xFF65559B),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        const Text(
          'Milo’s soil is starting to dry. Check it again soon, and water when the top layer feels dry.',
          style: TextStyle(
            fontSize: 13,
            height: 1.45,
            color: Color(0xFF48415F),
          ),
        ),
        const SizedBox(height: 9),
        TextButton.icon(
          onPressed: () => setState(() => _selectedTab = 2),
          style: TextButton.styleFrom(
            padding: EdgeInsets.zero,
            visualDensity: VisualDensity.compact,
          ),
          icon: const Icon(Icons.chat_bubble_outline_rounded, size: 16),
          label: const Text('Ask Plant AI'),
        ),
      ],
    ),
  );

  Widget _wateringCard() => Container(
    padding: const EdgeInsets.all(17),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: const Color(0xFFE9EBE5)),
    ),
    child: Row(
      children: [
        Container(
          width: 42,
          height: 42,
          decoration: BoxDecoration(
            color: const Color(0xFFE8F2EC),
            borderRadius: BorderRadius.circular(13),
          ),
          child: const Icon(Icons.water_drop_rounded, color: Color(0xFF245C45)),
        ),
        const SizedBox(width: 12),
        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Watering control',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
              ),
              SizedBox(height: 3),
              Text(
                'Manual demo control · pump disconnected',
                style: TextStyle(fontSize: 11, color: Colors.black54),
              ),
            ],
          ),
        ),
        FilledButton(
          onPressed: _waterPlant,
          style: FilledButton.styleFrom(
            backgroundColor: _pumpRunning
                ? const Color(0xFF9A493D)
                : const Color(0xFF245C45),
            padding: const EdgeInsets.symmetric(horizontal: 15),
          ),
          child: Text(_pumpRunning ? 'Stop' : 'Water'),
        ),
      ],
    ),
  );

  Widget _activityRow(
    IconData icon,
    String title,
    String subtitle,
    String time,
  ) => Padding(
    padding: const EdgeInsets.only(bottom: 9),
    child: Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Icon(icon, color: const Color(0xFF52715D), size: 20),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  subtitle,
                  style: TextStyle(fontSize: 11, color: Colors.grey.shade700),
                ),
              ],
            ),
          ),
          Text(
            time,
            style: TextStyle(fontSize: 9, color: Colors.grey.shade600),
          ),
        ],
      ),
    ),
  );

  Widget _buildPlaceholder() {
    final (icon, title, description) = switch (_selectedTab) {
      1 => (
        Icons.spa_outlined,
        'My plants',
        'Your plant collection and profiles will live here.',
      ),
      2 => (
        Icons.auto_awesome_outlined,
        'Plant AI',
        'Ask questions about your plant using its care history and sensor readings.',
      ),
      _ => (
        Icons.tune_rounded,
        'Settings',
        'Manage device connection, thresholds, and notifications.',
      ),
    };
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 45, color: const Color(0xFF245C45)),
            const SizedBox(height: 13),
            Text(
              title,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 8),
            Text(
              description,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.black54, height: 1.5),
            ),
            const SizedBox(height: 17),
            OutlinedButton(
              onPressed: () => setState(() => _selectedTab = 0),
              child: const Text('Back to overview'),
            ),
          ],
        ),
      ),
    );
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
    );
  }
}
