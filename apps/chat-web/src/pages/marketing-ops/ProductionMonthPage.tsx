import ProductionCalendarPage, { type ProductionCalendarPageProps } from './ProductionCalendarPage';

type ProductionMonthPageProps = Omit<ProductionCalendarPageProps, 'view'>;

export default function ProductionMonthPage(props: ProductionMonthPageProps) {
  return <ProductionCalendarPage view="month" {...props} />;
}
