docker compose build mininet


#Verificar dentro del contenedor

docker compose exec mininet which hping3


docker compose exec mininet which nmap




docker compose exec mininet apt-get update

docker compose exec mininet apt-get install -y \
    hping3 \
    nmap

docker compose exec mininet which hping3
docker compose exec mininet which nmap