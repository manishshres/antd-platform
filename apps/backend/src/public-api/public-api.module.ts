import { Module } from '@nestjs/common';
import { PublicMenusController } from './public-menus.controller';
import { PublicOrdersController } from './public-orders.controller';
import { MenusModule } from '../menus/menus.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [MenusModule, OrdersModule],
  controllers: [PublicMenusController, PublicOrdersController],
})
export class PublicApiModule {}
