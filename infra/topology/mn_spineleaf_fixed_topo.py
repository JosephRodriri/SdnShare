#!/usr/bin/python3
from mininet.net import Mininet
from mininet.node import RemoteController
from mininet.node import OVSSwitch
from mininet.node import Host
from mininet.link import TCLink
from mininet.log import setLogLevel
from mininet.log import info
from mininet.cli import CLI
import socket

def create_mininet_network():
    """
    Create Mininet network topology of three leaf switches, two spine switches
    and six hosts.
    """
    info("*** Create a network with OVS switches")
    net = Mininet(controller=RemoteController, link=TCLink, switch=OVSSwitch)
    info("*** Adding controller\n")
    controller_ip = socket.gethostbyname("controller")
    info("Controller IP: {}\n".format(controller_ip))
    c0 = net.addController(
        "ctrl", controller=RemoteController, ip=controller_ip, port=6633
    )

    info("*** Adding switches\n")
    # ✅ CAMBIO: agregado failMode='standalone' y protocols='OpenFlow13'
    #    - failMode='standalone' → el switch reenvía tráfico aunque no haya flow instalado
    #    - protocols='OpenFlow13' → evita los ErrorMsg / bad_request que aparecían en los logs
    s11 = net.addSwitch("SW11", failMode="standalone", protocols="OpenFlow13")  # Spine
    s12 = net.addSwitch("SW12", failMode="standalone", protocols="OpenFlow13")  # Spine
    s21 = net.addSwitch("SW21", failMode="standalone", protocols="OpenFlow13")  # Leaf
    s22 = net.addSwitch("SW22", failMode="standalone", protocols="OpenFlow13")  # Leaf
    s23 = net.addSwitch("SW23", failMode="standalone", protocols="OpenFlow13")  # Leaf

    info("*** Adding hosts\n")
    h1 = net.addHost(
        "h1",
        cls=Host,
        mac="00:00:00:00:00:01",
        ip="10.1.1.10",
        defaultRoute="via 10.1.1.1",
    )
    h2 = net.addHost(
        "h2",
        cls=Host,
        mac="00:00:00:00:00:02",
        ip="10.1.1.20",
        defaultRoute="via 10.1.1.1",
    )
    h3 = net.addHost(
        "h3",
        cls=Host,
        mac="00:00:00:00:00:03",
        ip="10.1.1.30",
        defaultRoute="via 10.1.1.1",
    )
    h4 = net.addHost(
        "h4",
        cls=Host,
        mac="00:00:00:00:00:04",
        ip="10.1.1.40",
        defaultRoute="via 10.1.1.1",
    )
    h5 = net.addHost(
        "h5",
        cls=Host,
        mac="00:00:00:00:00:05",
        ip="10.1.1.50",
        defaultRoute="via 10.1.1.1",
    )
    h6 = net.addHost(
        "h6",
        cls=Host,
        mac="00:00:00:00:00:06",
        ip="10.1.1.60",
        defaultRoute="via 10.1.1.1",
    )

    info("*** Adding links\n")
    net.addLink(s11, s21, 1, 1)
    net.addLink(s11, s22, 2, 1)
    net.addLink(s11, s23, 3, 1)
    net.addLink(s12, s21, 1, 2)
    net.addLink(s12, s22, 2, 2)
    net.addLink(s12, s23, 3, 2)
    net.addLink(s21, h1, 3)
    net.addLink(s21, h2, 4)
    net.addLink(s22, h3, 3)
    net.addLink(s22, h4, 4)
    net.addLink(s23, h5, 3)
    net.addLink(s23, h6, 4)

    info("*** Starting network\n")
    net.build()

    info("*** Starting controllers\n")
    c0.start()

    info("*** Starting switches\n")
    s11.start([c0])
    s12.start([c0])
    s21.start([c0])
    s22.start([c0])
    s23.start([c0])

    # ✅ CAMBIO: forzar nombre limpio y predecible en interfaces de hosts
    #    Así arpspoof y hping3 siempre usan el mismo nombre de interfaz
    info("*** Renaming host interfaces\n")
    host_iface_map = [
        (h1, "h1-eth0"), (h2, "h2-eth0"), (h3, "h3-eth0"),
        (h4, "h4-eth0"), (h5, "h5-eth0"), (h6, "h6-eth0"),
    ]
    for host, target_name in host_iface_map:
        # Obtiene el nombre actual de la única interfaz del host (distinto de lo)
        real_name = host.intf().name
        if real_name != target_name:
            host.cmd("ip link set {} name {}".format(real_name, target_name))
            host.nameToIntf[target_name] = host.nameToIntf.pop(real_name)

    info("*** Network ready — interfaces renamed to h*-eth0\n")
    info("*** IPs: h1=10.1.1.10  h2=10.1.1.20  h3=10.1.1.30\n")
    info("***      h4=10.1.1.40  h5=10.1.1.50  h6=10.1.1.60\n")

    CLI(net)

    info("*** Stopping network\n")
    net.stop()


if __name__ == "__main__":
    # run using:
    # sudo /path/mn_spineleaf_fixed_topo.py
    setLogLevel("info")
    create_mininet_network()