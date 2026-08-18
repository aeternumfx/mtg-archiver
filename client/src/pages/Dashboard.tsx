import { useState, useEffect } from 'react';
import { Card, Text, Title, Group, NumberFormatter, Table, SimpleGrid, Box, Tooltip } from '@mantine/core';
import { PieChart, AreaChart, DonutChart } from '@mantine/charts';
import { IconCards, IconCoin, IconTrendingUp, IconTrendingDown, IconMinus, IconArrowUpRight, IconClock } from '@tabler/icons-react';
import { api } from '../api/client';
import { SetSymbol } from '../components/CardDisplay';

const PIE_COLORS = ['blue.6', 'teal.6', 'violet.6', 'orange.6', 'cyan.6', 'pink.6', 'lime.6', 'grape.6'];

const RARITY_COLORS: Record<string, string> = {
  common: 'gray.6', uncommon: 'blue.6', rare: 'yellow.6', mythic: 'orange.6', special: 'grape.6', bonus: 'pink.6',
};


function PieLegend({ data }: { data: Array<{ name: string; value: number; color: string }> }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <Group gap="xs" mt="sm" wrap="wrap" justify="center">
      {data.map(d => (
        <Group key={d.name} gap={4} wrap="nowrap">
          <Box w={10} h={10} style={{ borderRadius: 3, background: `var(--mantine-color-${d.color.split('.')[0]}-${d.color.split('.')[1] || '6'})`, flexShrink: 0 }} />
          <Text size="xs" c="dimmed">{d.name}</Text>
          <Text size="xs" fw={600}>{total > 0 ? Math.round((d.value / total) * 100) : 0}%</Text>
        </Group>
      ))}
    </Group>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<{
    totalCards: number;
    purchaseValue: number;
    marketValue: number;
    trueMarketValue: number;
    bulkCards: number;
    byLocation: Array<{ id: number; name: string; count: number; value: number; marketValue: number }>;
    deckBreakdown: Array<{ id: number; name: string; count: number; value: number; marketValue: number }>;
    valueHistory: Array<{ date: string; totalCards: number; totalValue: number; purchaseValue: number | null }>;
    rarityBreakdown: Array<{ rarity: string; count: number; value: number }>;
    conditionBreakdown: Array<{ condition: string; count: number; value: number }>;
    topCards: Array<{ cardId: string; name: string; setName: string; setCode: string; totalQty: number; totalValue: number; marketPrice: number | null }>;
    recentAdditions: Array<{ cardId: string; name: string; quantity: number; purchasePrice: number | null; createdAt: string }>;
  }>({
    totalCards: 0, purchaseValue: 0, marketValue: 0, trueMarketValue: 0, bulkCards: 0, byLocation: [], deckBreakdown: [], valueHistory: [],
    rarityBreakdown: [], conditionBreakdown: [], topCards: [], recentAdditions: [],
  });

  useEffect(() => {
    api.dashboard.stats().then(setStats).catch(() => {});
  }, []);

  const unrealizedGL = stats.marketValue - stats.purchaseValue;
  const glPercent = stats.purchaseValue > 0 ? (unrealizedGL / stats.purchaseValue) * 100 : 0;
  const chartData = [...stats.valueHistory].reverse().map(h => ({
    date: h.date.slice(5),
    value: Number(h.totalValue.toFixed(2)),
    cost: Number((h.purchaseValue ?? 0).toFixed(2)),
  }));

  const groupBreakdown = [
    ...stats.deckBreakdown.map(d => ({ id: d.id, name: d.name, count: d.count, value: d.value, marketValue: d.marketValue, kind: 'deck' })),
    ...stats.byLocation.filter(l => l.count > 0 || l.marketValue > 0).map(l => ({ id: l.id, name: l.name, count: l.count, value: l.value, marketValue: l.marketValue, kind: 'location' })),
  ];

  const locationPie = groupBreakdown.filter(g => g.count > 0).map((g, i) => ({
    name: `${g.kind === 'deck' ? '🂠 ' : ''}${g.name}`, value: g.count, color: PIE_COLORS[i % PIE_COLORS.length],
  }));

  const rarityPie = stats.rarityBreakdown.filter(r => r.count > 0).map(r => ({
    name: r.rarity.charAt(0).toUpperCase() + r.rarity.slice(1),
    value: r.count,
    color: RARITY_COLORS[r.rarity] || 'gray.6',
  }));

  const locValuePie = groupBreakdown.filter(g => g.marketValue > 0).map((g, i) => ({
    name: `${g.kind === 'deck' ? '🂠 ' : ''}${g.name}`,
    value: Math.round(g.marketValue),
    color: PIE_COLORS[i % PIE_COLORS.length],
  })).sort((a, b) => b.value - a.value).slice(0, 6);

  const cardInCollection = stats.totalCards > 0;

  return (
    <>
      <Title order={2} mb="lg">Dashboard</Title>

      <SimpleGrid mb="lg" data-tour="dashboard-stats" cols={{ base: 1, sm: 2, lg: 5 }}>
        
          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <Group>
              <Box w={44} h={44} style={{ borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--mantine-color-blue-1)', color: 'var(--mantine-color-blue-7)' }}>
                <IconCards size={24} />
              </Box>
              <div>
                <Text size="xs" c="dimmed">Total Cards</Text>
                <Text size="xl" fw={700}><NumberFormatter value={stats.totalCards} /></Text>
              </div>
            </Group>
          </Card>
        
        
          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <Group>
              <Box w={44} h={44} style={{ borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--mantine-color-green-1)', color: 'var(--mantine-color-green-7)' }}>
                <IconCoin size={24} />
              </Box>
              <div>
                <Text size="xs" c="dimmed">Market Value</Text>
                <Text size="xl" fw={700}><NumberFormatter value={stats.marketValue} prefix="$" decimalScale={2} fixedDecimalScale /></Text>
              </div>
            </Group>
          </Card>
        
        
          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <Tooltip label={`${stats.bulkCards} bulk card${stats.bulkCards !== 1 ? 's' : ''} (under $1 each) counted at $0.01 — a realistic "true" value for low-priced bulk.`}>
              <Group>
                <Box w={44} h={44} style={{ borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--mantine-color-teal-1)', color: 'var(--mantine-color-teal-7)' }}>
                  <IconCoin size={24} />
                </Box>
                <div>
                  <Text size="xs" c="dimmed">True Market Value</Text>
                  <Text size="xl" fw={700}><NumberFormatter value={stats.trueMarketValue} prefix="$" decimalScale={2} fixedDecimalScale /></Text>
                </div>
              </Group>
            </Tooltip>
          </Card>
        
        
          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <Group>
              <Box w={44} h={44} style={{ borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--mantine-color-orange-1)', color: 'var(--mantine-color-orange-7)' }}>
                <IconCoin size={24} />
              </Box>
              <div>
                <Text size="xs" c="dimmed">Cost Basis</Text>
                <Text size="xl" fw={700}><NumberFormatter value={stats.purchaseValue} prefix="$" decimalScale={2} fixedDecimalScale /></Text>
              </div>
            </Group>
          </Card>
        
        
          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <Group>
              <Box w={44} h={44} style={{ borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: unrealizedGL > 0 ? 'var(--mantine-color-green-1)' : unrealizedGL < 0 ? 'var(--mantine-color-red-1)' : 'var(--mantine-color-gray-1)', color: unrealizedGL > 0 ? 'var(--mantine-color-green-7)' : unrealizedGL < 0 ? 'var(--mantine-color-red-7)' : 'var(--mantine-color-gray-7)' }}>
                {unrealizedGL > 0 ? <IconTrendingUp size={24} />
                  : unrealizedGL < 0 ? <IconTrendingDown size={24} />
                  : <IconMinus size={24} />}
              </Box>
              <div>
                <Text size="xs" c="dimmed">Unrealized P&amp;L</Text>
                <Text size="xl" fw={700} c={unrealizedGL > 0 ? 'green' : unrealizedGL < 0 ? 'red' : undefined}>
                  <NumberFormatter value={unrealizedGL} prefix="$" decimalScale={2} fixedDecimalScale />
                  {glPercent !== 0 && <> ({glPercent > 0 ? '+' : ''}{glPercent.toFixed(1)}%)</>}
                </Text>
              </div>
            </Group>
          </Card>
        
      </SimpleGrid>

      {!cardInCollection && (
        <Text c="dimmed" ta="center" py="xl">Add some cards to your collection to see stats here.</Text>
      )}

      {cardInCollection && (
        <>
          {chartData.length > 1 && (
            <Card shadow="sm" padding="lg" radius="md" withBorder mb="md">
              <Text fw={500} mb="md">Collection Value Over Time</Text>
              <AreaChart
                h={280}
                data={chartData}
                dataKey="date"
                series={[
                  { name: 'value', label: 'Market Value', color: 'blue.6' },
                  { name: 'cost', label: 'Cost Basis', color: 'orange.6' },
                ]}
                curveType="monotone"
                withGradient
                withDots
                dotProps={{ r: 3, strokeWidth: 0 }}
                withLegend
                legendProps={{ verticalAlign: 'top', height: 30 }}
                areaProps={{ animationDuration: 900, animationEasing: 'ease-out' }}
                valueFormatter={v => `$${v.toFixed(0)}`}
              />
            </Card>
          )}

          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} mb="md">
            {locationPie.length > 1 && (
              <Card shadow="sm" padding="lg" radius="md" withBorder>
                <Text fw={500} mb="md">Cards by Location &amp; Deck</Text>
                <Box style={{ display: 'flex', justifyContent: 'center' }}>
                  <PieChart data={locationPie} withLabelsLine labelsPosition="outside" labelsType="percent" withLabels size={180}
                    pieProps={{ animationDuration: 900, animationEasing: 'ease-out' }} />
                </Box>
                <PieLegend data={locationPie} />
              </Card>
            )}
            {rarityPie.length > 1 && (
              <Card shadow="sm" padding="lg" radius="md" withBorder>
                <Text fw={500} mb="md">Cards by Rarity</Text>
                <Box style={{ display: 'flex', justifyContent: 'center' }}>
                  <DonutChart data={rarityPie} size={160} thickness={26} pieProps={{ animationDuration: 900, animationEasing: 'ease-out' }} />
                </Box>
                <PieLegend data={rarityPie} />
              </Card>
            )}
            {locValuePie.length > 1 && (
              <Card shadow="sm" padding="lg" radius="md" withBorder>
                <Text fw={500} mb="md">Value Distribution</Text>
                <Box style={{ display: 'flex', justifyContent: 'center' }}>
                  <DonutChart data={locValuePie} size={160} thickness={28} pieProps={{ animationDuration: 1000, animationEasing: 'ease-out' }} />
                </Box>
                <PieLegend data={locValuePie} />
              </Card>
            )}
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, md: 2 }} mb="md">
            {stats.topCards.length > 0 && (
              <Card shadow="sm" padding="lg" radius="md" withBorder>
                <Group mb="md">
                  <IconArrowUpRight size={18} />
                  <Text fw={500}>Most Valuable Cards</Text>
                </Group>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Card</Table.Th>
                      <Table.Th w={50}>Qty</Table.Th>
                      <Table.Th w={70}>Value</Table.Th>
                      <Table.Th w={70}>Market</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {stats.topCards.map(c => (
                      <Table.Tr key={c.cardId}>
                        <Table.Td>
                          <Group gap="sm" wrap="nowrap">
                            <Text size="xs" fw={500} lineClamp={1}>{c.name}</Text>
                            <SetSymbol code={c.setCode} name={c.setName} size={12} />
                          </Group>
                        </Table.Td>
                        <Table.Td><Text size="xs">{c.totalQty}</Text></Table.Td>
                        <Table.Td><Text size="xs"><NumberFormatter value={c.totalValue} prefix="$" decimalScale={2} fixedDecimalScale /></Text></Table.Td>
                        <Table.Td>
                          {c.marketPrice ? (
                            <Text size="xs" c={c.marketPrice > 0 ? 'green' : 'dimmed'}>
                              <NumberFormatter value={c.marketPrice} prefix="$" decimalScale={2} fixedDecimalScale />
                            </Text>
                          ) : <Text size="xs" c="dimmed">-</Text>}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Card>
            )}

            {stats.recentAdditions.length > 0 && (
              <Card shadow="sm" padding="lg" radius="md" withBorder>
                <Group mb="md">
                  <IconClock size={18} />
                  <Text fw={500}>Recent Additions</Text>
                </Group>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Card</Table.Th>
                      <Table.Th w={50}>Qty</Table.Th>
                      <Table.Th w={70}>Price</Table.Th>
                      <Table.Th w={90}>Added</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {stats.recentAdditions.map((c, i) => (
                      <Table.Tr key={`${c.cardId}-${i}`}>
                        <Table.Td>
                          <Text size="xs" fw={500} lineClamp={1}>{c.name}</Text>
                        </Table.Td>
                        <Table.Td><Text size="xs">{c.quantity}</Text></Table.Td>
                        <Table.Td>
                          {c.purchasePrice ? (
                            <Text size="xs"><NumberFormatter value={c.purchasePrice} prefix="$" decimalScale={2} fixedDecimalScale /></Text>
                          ) : <Text size="xs" c="dimmed">-</Text>}
                        </Table.Td>
                        <Table.Td><Text size="xs">{c.createdAt}</Text></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Card>
            )}
          </SimpleGrid>
        </>
      )}
    </>
  );
}
