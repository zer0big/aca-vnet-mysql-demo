output "vm_mysql_private_ip" {
  value = azurerm_network_interface.nic_mysql.private_ip_address
}

output "vm_jump_public_ip" {
  value = azurerm_public_ip.jump_pip.ip_address
}

output "subnet_app_id" {
  value = azurerm_subnet.subnet_app.id
}

output "subnet_db_id" {
  value = azurerm_subnet.subnet_db.id
}

