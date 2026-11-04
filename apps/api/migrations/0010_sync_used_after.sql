ALTER TABLE `sync_chunk` ADD `used_after` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `sync_chunk` SET `used_after` = (SELECT sum(`earlier`.`size`) FROM `sync_chunk` AS `earlier` WHERE `earlier`.`user_id` = `sync_chunk`.`user_id` AND `earlier`.`id` <= `sync_chunk`.`id`);
