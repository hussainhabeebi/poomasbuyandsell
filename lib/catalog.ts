export const SITE_URL = 'https://www.poomasbuyandsell.com';
export const EMIRATES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain'];
export const TYPES = { property: ['Office', 'Retail shop', 'Warehouse', 'Commercial building', 'Commercial land', 'Showroom'], vehicle: ['SUV', 'Sedan', 'Hatchback', 'Pickup', 'Van', 'Truck', 'Motorcycle'] };
export const PACKAGES = [{ id: 'boost', name: 'Marketplace Spotlight', label: 'GET DISCOVERED', description: 'Give your listing a prominent place on Poomas.', features: ['Featured marketplace placement', 'Property or vehicle listing', 'Campaign enquiry summary'], icon: 'spotlight' }, { id: 'story', name: 'Instagram Story', label: 'START A CONVERSATION', description: 'Put your listing in front of Ajeesh’s Instagram audience.', features: ['Story feature on Ajeesh’s page', 'Direct link to your listing', 'Enquiries in your seller inbox'], icon: 'story' }, { id: 'reel', name: 'The Ajeesh Reel', label: 'TELL THE WHOLE STORY', description: 'A presenter-led video that shows what makes your listing special.', features: ['Presenter-led Instagram reel', 'Listing link and clear call to action', 'Content and schedule agreed with you'], icon: 'reel' }, { id: 'shoot', name: 'Shoot + Promote', label: 'FROM CAMERA TO CUSTOMER', description: 'Bring the listing to life with a shoot and promotion.', features: ['On-location video shoot', 'Edited video and Instagram reel', 'Featured marketplace placement'], icon: 'shoot' }];
export type Listing = {
    id: string;
    slug: string;
    owner_id?: string;
    seller_name: string;
    title: string;
    category: 'property' | 'vehicle';
    subtype: string;
    emirate: string;
    area: string;
    price: number;
    intent: string;
    description: string;
    specs: Record<string, string>;
    images: string[];
    video: string | null;
    permit?: string | null;
    status: string;
    rejection_reason?: string | null;
    created_at: string;
    updated_at: string;
    phone?: string;
    seller_email?: string;
};
export function money(n: number) { return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(n); }
export function decodeListing(row: Record<string, unknown>): Listing { return { ...row, specs: JSON.parse(String(row.specs || '{}')), images: JSON.parse(String(row.images || '[]')) } as Listing; }
export function publicListing(l: Listing): Listing { const { owner_id, seller_email, phone, rejection_reason, ...safe } = l; void owner_id; void seller_email; void phone; void rejection_reason; return safe; }
export const GUIDES = [
    { slug: 'commercial-property-viewing-checklist', category: 'PROPERTY', title: 'A better commercial property viewing checklist', description: 'What to ask about space, access, parking and the details behind a commercial property listing.', sections: [['Start with the intended use', 'Tell the seller how you plan to use the space. Ask for the permitted use, restrictions, floor plan and supporting documents. A visually suitable property may still need additional approvals for your activity.'], ['Look beyond the floor area', 'Check usable area, loading access, lifts, power supply, ventilation, signage space and parking. Visit at a time that reflects your business hours to understand access and activity.'], ['Understand the full asking price', 'Confirm whether the listing is for sale or rent. For rent, ask whether the amount is annual and what deposits, service charges, fit-out costs and other expenses apply. Request a written breakdown.'], ['Confirm the seller’s authority', 'Ask who owns the property and whether the person advertising it is authorised to act. Check relevant documents with a qualified local professional before making a commitment.'], ['Keep a record', 'Save the listing and write down questions before your viewing. Compare the seller’s answers with the published details. Poomas connects you with sellers; the listing is not an independent valuation or document verification.']] },
    { slug: 'used-vehicle-viewing-checklist', category: 'VEHICLES', title: 'What to check before buying a used vehicle', description: 'A practical checklist for comparing mileage, service history, specification and condition.', sections: [['Ask for the history', 'Request the service record, ownership history and details of repairs. Ask specifically about accident history, outstanding finance and any known issues. Treat missing details as questions to resolve.'], ['Match the specification', 'Check the model year, trim, mileage, GCC or other specification, transmission and fuel type against the listing. Ask the seller to explain any inconsistencies.'], ['Arrange an independent inspection', 'Choose a qualified inspection provider to check the vehicle’s mechanical condition and structure. Photos, videos and an AI summary cannot replace an inspection.'], ['Make the test drive count', 'Agree a suitable time with the seller. Check visibility, steering, braking, transmission behaviour and warning lights. Record the questions you want an inspector to investigate.'], ['Agree the next steps in writing', 'Confirm the final price and what is included. Resolve ownership and transfer requirements before paying the seller. Poomas promotion payments are separate from the vehicle purchase.']] },
    { slug: 'prepare-a-listing-for-instagram', category: 'SELLER GUIDE', title: 'How to prepare a listing for an Ajeesh promotion', description: 'Build a clear, complete listing before you book a video or Instagram feature.', sections: [['Get the basics right', 'Add the asking price, location, key specifications and current availability. Be specific about what is included and disclose known issues. A complete listing helps buyers ask better questions.'], ['Show the real listing', 'Use current photos that you own or have permission to publish. For a property, show access and usable space. For a vehicle, show the exterior, interior and relevant details.'], ['Prepare the talking points', 'Explain what makes the listing suitable for a buyer without exaggerated claims. List three useful details and any limitations. AI can help draft copy, but you must check every fact.'], ['Request the right format', 'Choose a marketplace spotlight, story, reel or shoot package. The team confirms scope, schedule and the quoted price before payment. Paid promotion is not a promise of a sale.'], ['Be ready for enquiries', 'Make time to answer questions and arrange viewings. Keep your listing up to date and mark it sold or withdrawn when it is no longer available.']] }
];
