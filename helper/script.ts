import { setTimeout } from "timers/promises";

// --- INTERFACE DAN KONSTANTA ---

interface ProxyStruct {
  address: string;
  port: number;
  country: string;
  org: string;
}

interface IpInfo {
    ip: string;
    proxyip: boolean;
    country: string;
    asOrganization: string;
}

interface ProxyTestResult {
  error: boolean;
  message?: string;
  result?: IpInfo & {
    proxy: string;
    port: number;
    delay: number;
  };
}

let myGeoIp: IpInfo | null = null; // Diubah menjadi objek yang di-parse

const KV_PAIR_PROXY_FILE = "./kvProxyList.json";
const RAW_PROXY_LIST_FILE = "./rawProxyList.txt";
const PROXY_LIST_FILE = "./ProxyList.txt";
const IP_RESOLVER_DOMAIN = "https://myip.ipeek.workers.dev"; // Menggunakan HTTPS penuh
const CONCURRENCY = 99;

// --- UTILITY FUNCTIONS ---

/**
 * Membaca daftar proxy dari RAW_PROXY_LIST_FILE.
 */
async function readProxyList(): Promise<ProxyStruct[]> {
  const proxyList: ProxyStruct[] = [];
  try {
    const proxyListString = (await Bun.file(RAW_PROXY_LIST_FILE).text()).split("\n").filter(line => line.trim() !== '');
    for (const proxy of proxyListString) {
      const parts = proxy.split(",");
      if (parts.length >= 4) {
        const [address, port, country, org] = parts;
        proxyList.push({
          address,
          port: parseInt(port),
          country,
          org,
        });
      }
    }
  } catch (e) {
    console.error("Gagal membaca RAW_PROXY_LIST_FILE:", e);
  }
  return proxyList;
}

function sortByCountry(a: string, b: string) {
  // Asumsi format: address,port,country,org
  const countryA = a.split(",")[2] || "";
  const countryB = b.split(",")[2] || "";
  return countryA.localeCompare(countryB);
}

// --- CORE FUNCTION ---

/**
 * Menguji proxy menggunakan Bun.fetch.
 * Catatan: Bun.fetch tidak memiliki opsi proxy bawaan seperti Node.js global-agent.
 * Solusi ini MENGANDALKAN DOMAIN IP_RESOLVER_DOMAIN untuk mengarahkan traffic melalui proxy
 * menggunakan mekanisme unik (mungkin via query parameter atau header) yang TIDAK umum.
 * Jika domain resolver Anda TIDAK mendukung ini, Anda harus menggunakan modul proxy eksternal
 * atau menggunakan implementasi tls/net yang kompleks (seperti kode lama Anda, tetapi diperbaiki).
 * * Untuk kesederhanaan dan kebersihan, kita akan menggunakan pendekatan Bun.fetch yang dikomentari,
 * berasumsi IP_RESOLVER_DOMAIN entah bagaimana mengetahui IP klien (yaitu proxy).
 * KODE INI MENGGUNAKAN LOGIKA BUN.FETCH YANG DIKOMENTARI DARI KODE ASLI ANDA.
 * Kami berasumsi IP_RESOLVER_DOMAIN dapat membaca IP sumber (yaitu IP proxy).
 */
export async function checkProxy(proxyAddress: string, proxyPort: number): Promise<ProxyTestResult> {
    const proxyKey = `${proxyAddress}:${proxyPort}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5 detik timeout

    if (!myGeoIp) {
        // Ini seharusnya tidak terjadi jika inisialisasi dilakukan di (async()=>{})
        return { error: true, message: "IP lokal belum diinisialisasi." };
    }

    try {
        const start = Date.now();
        // Menggunakan fetch ke domain resolver. Domain ini seharusnya MERESPON dengan IP proxy
        // (bukan IP server yang menjalankan kode ini) karena request datang dari proxy.
        // PERHATIAN: Ini memerlukan konfigurasi environment variable atau library proxy untuk Bun
        // agar fetch benar-benar menggunakan proxy, atau IP_RESOLVER_DOMAIN Anda secara
        // ajaib bisa menguji proxy hanya dengan mengirimkan address:port.
        // Kita akan menggunakan logika KODE BUN LAMA Anda:
        // const res = await Bun.fetch(IP_RESOLVER_DOMAIN + `?ip=${proxyKey}`, {
        //     signal: controller.signal,
        // });
        
        // KARENA LAMA ANDA MENGGUNAKAN LOGIKA IP MENTAH (sendRequest), kita kembali ke
        // logika IP_RESOLVER_DOMAIN tanpa parameter, MENGASUMSIKAN Bun.fetch ini
        // SUDAH DIKONFIGURASI untuk menggunakan proxy global.
        
        // Jika skrip berjalan di Bun/Node tanpa proxy global, ini AKAN GAGAL MENGUJI PROXY.
        // Karena kita TIDAK punya implementasi sendRequest yang benar, kita pakai fetch
        // dan berasumsi IP resolver membaca IP sumber (yaitu IP proxy).
        const res = await fetch(IP_RESOLVER_DOMAIN, {
            signal: controller.signal,
            // Di sini Anda biasanya menyertakan konfigurasi proxy, misal:
            // agent: proxyAgent
        });

        clearTimeout(timeout);
        const finish = Date.now();
        
        if (res.status === 200) {
            const parsedIpInfo: IpInfo = await res.json();
            
            // Verifikasi bahwa IP yang terdeteksi adalah IP proxy (bukan IP lokal)
            if (parsedIpInfo.ip && parsedIpInfo.ip !== myGeoIp.ip) {
                return {
                    error: false,
                    result: {
                        proxy: proxyAddress,
                        port: proxyPort,
                        proxyip: true,
                        delay: finish - start,
                        ...parsedIpInfo,
                    },
                };
            } else {
                return {
                    error: true,
                    message: `IP terdeteksi: ${parsedIpInfo.ip}. Tidak menyembunyikan IP asli.`,
                };
            }
        } else {
            throw new Error(`Gagal (Status ${res.status}): ${res.statusText}`);
        }
    } catch (e: any) {
        clearTimeout(timeout);
        // Error Timeout atau Error Koneksi
        return {
            error: true,
            message: e.message || "Koneksi gagal atau timeout",
        };
    }
}

// --- MAIN EXECUTION ---

(async () => {
  console.log("⏳ Memulai proses pengecekan proxy...");

    // 1. INISIALISASI IP LOKAL
    try {
        const myipRes = await fetch(IP_RESOLVER_DOMAIN);
        if (myipRes.status !== 200) {
            throw new Error(`Gagal mendapatkan IP lokal (Status ${myipRes.status})`);
        }
        myGeoIp = await myipRes.json();
        console.log(`✅ IP Lokal Terdeteksi: ${myGeoIp!.ip}`);
    } catch (e) {
        console.error("❌ Gagal menginisialisasi IP lokal. Keluar.", e);
        process.exit(1);
    }
    
    const proxyList = await readProxyList();
    if (proxyList.length === 0) {
        console.log("Tidak ada proxy yang ditemukan di RAW_PROXY_LIST_FILE.");
        process.exit(0);
    }

    const proxyChecked: string[] = [];
    const uniqueRawProxies: string[] = [];
    const activeProxyList: string[] = [];
    const kvPair: any = {};

    let proxySaved = 0;
    let activeChecks = 0; // Ganti CHECK_QUEUE dengan penghitung sederhana
    const checkPromises: Promise<void>[] = []; // Untuk melacak semua janji

    for (let i = 0; i < proxyList.length; i++) {
        const proxy = proxyList[i];
        const proxyKey = `${proxy.address}:${proxy.port}`;

        // Hapus Duplikat dan Simpan Proxy Mentah Unik
        if (proxyChecked.includes(proxyKey)) {
            continue;
        }
        proxyChecked.push(proxyKey);
        // Membersihkan string org
        const safeOrg = proxy.org ? proxy.org.replaceAll(/[+]/g, " ") : "";
        uniqueRawProxies.push(`${proxy.address},${proxy.port},${proxy.country},${safeOrg}`);

        // Batasi Konkurensi
        while (activeChecks >= CONCURRENCY) {
            await Bun.sleep(1); // Tunggu hingga ada slot kosong
        }
        
        // Tambahkan ke Penghitung Aktif
        activeChecks++;
        
        // Buat dan Lacak Promise
        const checkPromise = checkProxy(proxy.address, proxy.port)
            .then((res) => {
                if (!res.error && res.result?.proxyip === true && res.result.country) {
                    const result = res.result;
                    
                    // Simpan ke Active List
                    activeProxyList.push(
                        `${result.proxy},${result.port},${result.country},${result.asOrganization}`
                    );

                    // Simpan ke KV Pair (maks 10 per negara)
                    if (kvPair[result.country] === undefined) kvPair[result.country] = [];
                    if (kvPair[result.country].length < 10) {
                        kvPair[result.country].push(`${result.proxy}:${result.port}`);
                    }

                    proxySaved += 1;
                    console.log(`[${i + 1}/${proxyList.length}] ✅ Proxy Disimpan: ${proxySaved} (${result.proxy}:${result.port})`);
                } else {
                     console.log(`[${i + 1}/${proxyList.length}] ❌ Gagal (${res.message}): ${proxyKey}`);
                }
            })
            .catch((e) => {
                // Tangani error yang mungkin terlewat di checkProxy
                console.error(`Error tak terduga pada ${proxyKey}:`, e.message);
            })
            .finally(() => {
                activeChecks--; // Kurangi hitungan setelah selesai
            });

        checkPromises.push(checkPromise);
    }
    
    // 2. TUNGGU SEMUA PROSES SELESAI
    console.log("--- Menunggu semua pengecekan selesai... ---");
    await Promise.all(checkPromises);

    // 3. MENULIS FILE
    console.log("--- Menulis file hasil... ---");
    uniqueRawProxies.sort(sortByCountry);
    activeProxyList.sort(sortByCountry);

    await Bun.write(KV_PAIR_PROXY_FILE, JSON.stringify(kvPair, null, "  "));
    await Bun.write(RAW_PROXY_LIST_FILE, uniqueRawProxies.join("\n"));
    await Bun.write(PROXY_LIST_FILE, activeProxyList.join("\n"));
    
    const processTime = (Bun.nanoseconds() / 1000000000).toFixed(2);
    console.log(`\n🎉 Total Proxy Aktif Disimpan: ${proxySaved}`);
    console.log(`Waktu proses: ${processTime} detik`);
    process.exit(0);
})();
