import ProductionCalendarPage, { type ProductionCalendarPageProps } from './ProductionCalendarPage';

type ProductionWeekPageProps = Omit<ProductionCalendarPageProps, 'view'>;

export default function ProductionWeekPage(props: ProductionWeekPageProps) {
  return <ProductionCalendarPage view="week" {...props} />;
}
