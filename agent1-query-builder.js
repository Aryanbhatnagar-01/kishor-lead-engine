const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Denmark master data from your Excel sheet
// These are the brands and contacts you already researched
const DENMARK_CONTACTS = [
  // DK Company A/S
  { brand: "DK Company A/S", name: "Julie Leth", title: "Express Buyer", email: "jl@dkcompany.com", city: "Ikast" },
  { brand: "DK Company A/S", name: "Nina Hornshøj", title: "Buyer", email: "nh@dkcompany.com", city: "Ikast" },
  { brand: "DK Company A/S", name: "Mette Resting Keseler", title: "Senior Buyer", email: "mrk@dkcompany.com", city: "Ikast" },
  { brand: "DK Company A/S", name: "Iben Arnholtz Neustädter", title: "Sourcing Manager", email: "ian@dkcompany.com", city: "Ikast" },
  { brand: "DK Company A/S", name: "Katrine Seistrup", title: "Buying Manager", email: "ks@dkcompany.com", city: "Ikast" },
  // Kompagniet af 1991
  { brand: "Kompagniet af 1991", name: "Dorina Blouner", title: "Buyer", email: "db@komp1991.dk", city: "Syddanmark" },
  { brand: "Kompagniet af 1991", name: "Suna Alsema", title: "Sourcing", email: "sa@komp1991.dk", city: "Syddanmark" },
  // ZIZZI
  { brand: "ZIZZI", name: "Maria Koch", title: "Head of Buying and Sourcing", email: "maria@zizzifashion.com", city: "Billund" },
  { brand: "ZIZZI", name: "Pernille Bundgaard Dam", title: "Product Director", email: "pernille@zizzifashion.com", city: "Billund" },
  { brand: "ZIZZI", name: "Ditte Lyng Smedegaard", title: "Category Buyer", email: "ditte@zizzifashion.com", city: "Billund" },
  // GANNI
  { brand: "GANNI", name: "Signe Larsen", title: "Head of Sourcing & Production", email: "signe.larsen@ganni.com", city: "Copenhagen" },
  { brand: "GANNI", name: "Veronika Ten", title: "Buying Manager", email: "veronika.ten@ganni.com", city: "Copenhagen" },
  // Konges Sløjd
  { brand: "Konges Sløjd", name: "Emilie Eberhardt", title: "Product Director", email: "emiliee@kongessloejd.com", city: "Copenhagen" },
  { brand: "Konges Sløjd", name: "Mads Bruno Andreasen", title: "Procurement Specialist", email: "madsa@kongessloejd.com", city: "Copenhagen" },
  { brand: "Konges Sløjd", name: "Niki Christiansen", title: "Procurement Assistant", email: "nikic@kongessloejd.com", city: "Copenhagen" },
  // MOS MOSH
  { brand: "MOS MOSH", name: "Tina Fuglsang-Poulsen", title: "Buying Manager", email: "tfp@mosmosh.com", city: "Kolding" },
  { brand: "MOS MOSH", name: "Mads A/S", title: "Buying Manager", email: "mas@mosmosh.com", city: "Kolding" },
  // INDICODE
  { brand: "INDICODE / IKS ApS", name: "Marianne Schultz", title: "Buyer", email: "ms@indicodejeans.dk", city: "Copenhagen" },
  { brand: "INDICODE / IKS ApS", name: "Camilla Bruhn", title: "Purchasing", email: "cb@indicodejeans.dk", city: "Copenhagen" },
];

async function importContacts() {
  console.log("\n============================================");
  console.log("  Importing Denmark Master Data to Supabase");
  console.log("============================================\n");

  const contacts = DENMARK_CONTACTS.map(c => ({
    company_name: c.brand,
    contact_name: c.name || null,
    job_title: c.title || null,
    email_1: c.email || null,
    country: "Denmark",
    source: "LinkedIn Research",
    status: "new",
    created_at: new Date().toISOString()
  }));

  const { data, error } = await supabase
    .from("contacts")
    .upsert(contacts, { onConflict: "email_1" });

  if (error) {
    console.error("❌ Error:", error.message);
  } else {
    console.log(`✅ Imported ${contacts.length} contacts to Supabase!`);
    console.log("🗄️  View in Supabase → Table Editor → contacts");
  }
}

importContacts().catch(console.error);
